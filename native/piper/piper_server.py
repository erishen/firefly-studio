#!/usr/bin/env python3
"""
Piper TTS 常驻服务（支持中英文分段合成）。
启动时加载两个模型到内存，将混合文本按语言分段，分别用对应模型合成，最后合并音频。

通信协议（行分隔 JSON）：
  Node -> Python: {"id": "xxx", "text": "你好 Hello", "rate": 1.0}
  Python -> Node: {"id": "xxx", "ok": true, "wav_path": "/tmp/xxx.wav", "size": 12345, "segments": [...]}
  Python -> Node: {"id": "xxx", "ok": false, "error": "..."}
"""
import sys
import json
import os
import re
import tempfile
import time
import wave
import traceback

# 中文字符范围
CHINESE_PATTERN = re.compile(r'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]')
# 英文字母和数字
ENGLISH_PATTERN = re.compile(r'[a-zA-Z0-9]')
# 段末需要去除的标点（避免模型把句号等读成异常音）
TRAILING_PUNCTUATION = '。！？，、；：""''（）【】《》…—·.,!?;:\'"()[]{}<>\t\n\r '

def clean_segment_end(text):
    """去除段末的标点符号和空白，避免模型把句号等读成异常音（如"色"）。"""
    return text.rstrip(TRAILING_PUNCTUATION)

def detect_char_lang(char):
    """检测单个字符的语言，返回 'zh', 'en', 或 None（标点/空格等）。"""
    if CHINESE_PATTERN.match(char):
        return 'zh'
    if ENGLISH_PATTERN.match(char):
        return 'en'
    return None

def split_by_language(text):
    """
    将文本按语言分段。
    返回列表: [{"lang": "zh"|"en", "text": "..."}]
    标点符号跟随前面的语言段。
    """
    segments = []
    current_lang = None
    current_text = []

    for char in text:
        char_lang = detect_char_lang(char)

        if char_lang is None:
            # 标点、空格等：如果当前有段，追加到当前段
            if current_lang is not None:
                current_text.append(char)
            # 如果没有当前段，忽略开头的标点空格
            continue

        if current_lang is None:
            # 开始第一段
            current_lang = char_lang
            current_text = [char]
        elif char_lang == current_lang:
            # 同语言，追加
            current_text.append(char)
        else:
            # 语言切换，保存当前段，开始新段
            segments.append({
                "lang": current_lang,
                "text": "".join(current_text).strip()
            })
            current_lang = char_lang
            current_text = [char]

    # 保存最后一段
    if current_lang is not None and current_text:
        segments.append({
            "lang": current_lang,
            "text": "".join(current_text).strip()
        })

    # 过滤空段
    segments = [s for s in segments if s["text"]]
    return segments

def synthesize_segment(voice, text, rate, sample_rate):
    """合成单段文本，返回 PCM 字节数据。"""
    from piper.config import SynthesisConfig

    syn_config = SynthesisConfig(length_scale=1.0/rate)
    audio_chunks = voice.synthesize(text, syn_config)

    all_bytes = b""
    for chunk in audio_chunks:
        all_bytes += chunk.audio_int16_bytes

    return all_bytes

def create_silence(duration_ms, sample_rate):
    """创建指定时长的静音 PCM 数据。"""
    num_samples = int(sample_rate * duration_ms / 1000)
    # 16-bit mono，每个样本 2 字节
    return b"\x00\x00" * num_samples

def apply_fade_in_out(pcm_bytes, fade_ms=10, sample_rate=22050):
    """
    对 PCM 数据应用淡入淡出，避免边界爆音。
    pcm_bytes: 16-bit little-endian mono PCM 字节数据
    fade_ms: 淡入淡出时长（毫秒）
    """
    if not pcm_bytes:
        return pcm_bytes

    # 转换为样本列表（16-bit signed little-endian）
    samples = []
    for i in range(0, len(pcm_bytes), 2):
        sample = int.from_bytes(pcm_bytes[i:i+2], byteorder='little', signed=True)
        samples.append(sample)

    num_samples = len(samples)
    fade_samples = min(int(sample_rate * fade_ms / 1000), num_samples // 2)

    if fade_samples <= 0:
        return pcm_bytes

    # 淡入
    for i in range(fade_samples):
        factor = i / fade_samples
        samples[i] = int(samples[i] * factor)

    # 淡出
    for i in range(fade_samples):
        factor = i / fade_samples
        idx = num_samples - 1 - i
        samples[idx] = int(samples[idx] * factor)

    # 转换回字节
    result = bytearray()
    for sample in samples:
        # 确保在 16-bit 范围内
        sample = max(-32768, min(32767, sample))
        result.extend(sample.to_bytes(2, byteorder='little', signed=True))

    return bytes(result)

def clip_pcm(pcm_bytes):
    """确保 PCM 数据在 16-bit 范围内，避免溢出爆音。"""
    if not pcm_bytes:
        return pcm_bytes

    result = bytearray()
    for i in range(0, len(pcm_bytes), 2):
        sample = int.from_bytes(pcm_bytes[i:i+2], byteorder='little', signed=True)
        sample = max(-32768, min(32767, sample))
        result.extend(sample.to_bytes(2, byteorder='little', signed=True))
    return bytes(result)

def main():
    try:
        if len(sys.argv) < 3:
            print(json.dumps({"ok": False, "error": "usage: piper_server.py <zh_model_path> <en_model_path>"}), flush=True)
            sys.exit(1)

        zh_model_path = sys.argv[1]
        en_model_path = sys.argv[2]

        if not os.path.exists(zh_model_path):
            print(json.dumps({"ok": False, "error": f"zh model not found: {zh_model_path}"}), flush=True)
            sys.exit(1)
        if not os.path.exists(en_model_path):
            print(json.dumps({"ok": False, "error": f"en model not found: {en_model_path}"}), flush=True)
            sys.exit(1)

        print(json.dumps({"ok": True, "status": "starting", "python": sys.executable}), flush=True)

        from piper import PiperVoice

        print(json.dumps({"ok": True, "status": "loading_zh", "model": zh_model_path}), flush=True)
        zh_voice = PiperVoice.load(zh_model_path)

        print(json.dumps({"ok": True, "status": "loading_en", "model": en_model_path}), flush=True)
        en_voice = PiperVoice.load(en_model_path)

        # 两个模型采样率相同（都是 22050）
        sample_rate = zh_voice.config.sample_rate if hasattr(zh_voice.config, 'sample_rate') else 22050

        print(json.dumps({
            "ok": True,
            "status": "ready",
            "zh_model": zh_model_path,
            "en_model": en_model_path,
            "sample_rate": sample_rate
        }), flush=True)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"startup failed: {e}", "traceback": traceback.format_exc()}), flush=True)
        sys.exit(1)

    tmp_dir = tempfile.gettempdir()
    # 段间静音时长（毫秒）
    SEGMENT_SILENCE_MS = 150

    # 循环读取请求
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id", "")
            text = req.get("text", "")
            rate = req.get("rate", 1.0)

            if not text:
                print(json.dumps({"id": req_id, "ok": False, "error": "empty text"}), flush=True)
                continue

            # 分段
            segments = split_by_language(text)

            if not segments:
                print(json.dumps({"id": req_id, "ok": False, "error": "no valid text segments"}), flush=True)
                continue

            # 合成每一段（不合并，由 Node.js C++ 模块合并）
            import base64
            start = time.time()

            segment_pcms = []
            segment_info = []

            for i, seg in enumerate(segments):
                seg_start = time.time()
                # 方案 A：中英文分段合成，各自发音标准（声音不同）
                voice = zh_voice if seg["lang"] == "zh" else en_voice
                # 清理段末标点，避免模型把句号等读成异常音
                seg_text = clean_segment_end(seg["text"])
                if not seg_text:
                    continue

                try:
                    seg_pcm = synthesize_segment(voice, seg_text, rate, sample_rate)
                    # 裁剪防溢出
                    seg_pcm = clip_pcm(seg_pcm)
                    # 每段淡入淡出，避免段间爆音（英文模型末尾常有非零值）
                    seg_pcm = apply_fade_in_out(seg_pcm, fade_ms=20, sample_rate=sample_rate)
                    seg_elapsed = time.time() - seg_start
                    segment_pcms.append(base64.b64encode(seg_pcm).decode('ascii'))
                    segment_info.append({
                        "index": i,
                        "lang": seg["lang"],
                        "text": seg_text[:50] + ("..." if len(seg_text) > 50 else ""),
                        "samples": len(seg_pcm) // 2,
                        "elapsed": round(seg_elapsed, 2)
                    })
                except Exception as seg_err:
                    # 单段合成失败，跳过该段，继续下一段
                    print(json.dumps({
                        "id": req_id,
                        "ok": True,
                        "warning": f"segment {i} ({seg['lang']}) failed: {seg_err}",
                    }), flush=True)
                    continue

            if not segment_pcms:
                print(json.dumps({"id": req_id, "ok": False, "error": "all segments failed"}), flush=True)
                continue

            elapsed = time.time() - start
            total_samples = sum(info["samples"] for info in segment_info)
            duration_ms = total_samples / sample_rate * 1000

            print(json.dumps({
                "id": req_id,
                "ok": True,
                "sample_rate": sample_rate,
                "duration_ms": round(duration_ms, 1),
                "segments": segment_info,
                "segment_count": len(segment_pcms),
                "segment_pcms": segment_pcms,
                "elapsed": round(elapsed, 2)
            }), flush=True)

        except Exception as e:
            print(json.dumps({"id": req.get("id", ""), "ok": False, "error": str(e), "traceback": traceback.format_exc()}), flush=True)

if __name__ == "__main__":
    main()
