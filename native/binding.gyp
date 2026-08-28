{
  "targets": [
    {
      "target_name": "firefly_native",
      "sources": [
        "src/addon.cc",
        "src/audio_engine.cc",
        "src/asr_client.cc",
        "src/mic_capture.cc",
        "src/asr_whisper.cc",
        "whisper.cpp/src/whisper.cpp",
        "whisper.cpp/ggml/src/ggml.c",
        "whisper.cpp/ggml/src/ggml-alloc.c",
        "whisper.cpp/ggml/src/ggml-quants.c",
        "whisper.cpp/ggml/src/ggml-backend.cpp",
        "whisper.cpp/ggml/src/ggml-backend-reg.cpp",
        "whisper.cpp/ggml/src/ggml-threading.cpp",
        "src/ggml-cpu-c.c",
        "whisper.cpp/ggml/src/ggml-cpu/ggml-cpu.cpp",
        "whisper.cpp/ggml/src/ggml-cpu/ggml-cpu-quants.c",
        "whisper.cpp/ggml/src/ggml-cpu/ggml-cpu-traits.cpp",
        "whisper.cpp/ggml/src/ggml-cpu/cpu-feats-x86.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "whisper.cpp/include",
        "whisper.cpp/ggml/include",
        "whisper.cpp/ggml/src",
        "whisper.cpp/ggml/src/ggml-cpu",
        "whisper.cpp/src"
      ],
      "cflags": [
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Wno-unused-parameter",
        "-Wno-unused-variable"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-Wall",
        "-Wextra",
        "-Wno-unused-parameter",
        "-Wno-unused-variable"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "CLANG_CXX_LIBRARY": "libc++",
        "OTHER_CPLUSPLUSFLAGS": [
          "-std=c++17",
          "-Wall",
          "-Wextra",
          "-Wno-unused-parameter",
          "-Wno-unused-variable"
        ],
        "OTHER_CFLAGS": [
          "-std=c11",
          "-Wno-unused-parameter",
          "-Wno-unused-variable"
        ]
      },
      "defines": [
        "NAPI_CPP_EXCEPTIONS",
        "GGML_USE_ACCELERATE",
        "GGML_USE_CPU",
        "WHISPER_VERSION=\"1.7.3\"",
        "GGML_VERSION=\"0.2.10\"",
        "GGML_COMMIT=\"unknown\"",
        "NDEBUG"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "OTHER_LDFLAGS": [
                "-framework", "CoreAudio",
                "-framework", "AudioToolbox",
                "-framework", "CoreFoundation",
                "-framework", "Accelerate"
              ]
            }
          }
        ]
      ],
      "dependencies": []
    }
  ]
}
