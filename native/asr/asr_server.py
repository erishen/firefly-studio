#!/usr/bin/env python3
"""
Faster-Whisper ASR 常驻服务。
启动时加载模型到内存，通过 stdin/stdout 行分隔 JSON 通信。

协议：
  Node -> Python: {"id": "xxx", "pcm_b64": "...", "language": "zh", "sample_rate": 16000}
  Python -> Node: {"id": "xxx", "ok": true, "text": "...", "language": "zh"}
  Python -> Node: {"id": "xxx", "ok": false, "error": "..."}
"""
import sys
import json
import base64
import struct
import traceback
import time

def main():
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"ok": False, "error": "usage: asr_server.py <model_path> [device]"}), flush=True)
            sys.exit(1)

        model_path = sys.argv[1]
        device = sys.argv[2] if len(sys.argv) > 2 else "cpu"
        compute_type = sys.argv[3] if len(sys.argv) > 3 else "int8"

        print(json.dumps({"ok": True, "status": "starting", "model": model_path, "device": device}), flush=True)

        from faster_whisper import WhisperModel

        print(json.dumps({"ok": True, "status": "loading_model", "model": model_path}), flush=True)
        # model_path 可以是 HuggingFace 模型名称（如 "Systran/faster-whisper-base"），会自动下载
        # 也可以是本地模型目录路径
        model = WhisperModel(model_path, device=device, compute_type=compute_type)

        print(json.dumps({"ok": True, "status": "ready", "model": model_path, "device": device}), flush=True)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"startup failed: {e}", "traceback": traceback.format_exc()}), flush=True)
        sys.exit(1)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id", "")
            pcm_b64 = req.get("pcm_b64", "")
            language = req.get("language", "zh")
            sample_rate = req.get("sample_rate", 16000)

            if not pcm_b64:
                print(json.dumps({"id": req_id, "ok": False, "error": "empty pcm"}), flush=True)
                continue

            # 解码 base64 PCM16 数据
            pcm_bytes = base64.b64decode(pcm_b64)
            # 转换为 numpy float32 数组（faster-whisper 需要 numpy 数组）
            import numpy as np
            pcm_int16 = np.frombuffer(pcm_bytes, dtype=np.int16)
            pcm_float = pcm_int16.astype(np.float32) / 32768.0

            start = time.time()
            segments, info = model.transcribe(
                pcm_float,
                language=language,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
            )

            text = "".join(seg.text for seg in segments).strip()
            elapsed = time.time() - start

            print(json.dumps({
                "id": req_id,
                "ok": True,
                "text": text,
                "language": info.language,
                "duration": round(info.duration, 2),
                "elapsed": round(elapsed, 2)
            }), flush=True)

        except Exception as e:
            print(json.dumps({
                "id": req.get("id", ""),
                "ok": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }), flush=True)

if __name__ == "__main__":
    main()
