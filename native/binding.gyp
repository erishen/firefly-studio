{
  "targets": [
    {
      "target_name": "qt_native",
      "sources": [
        "src/addon.cc",
        "src/audio_engine.cc",
        "src/asr_client.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags": [
        "-std=c++17",
        "-Wall",
        "-Wextra"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-Wall",
        "-Wextra"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "CLANG_CXX_LIBRARY": "libc++",
        "OTHER_CPLUSPLUSFLAGS": [
          "-std=c++17",
          "-Wall",
          "-Wextra"
        ]
      },
      "defines": [
        "NAPI_CPP_EXCEPTIONS"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES"
            }
          }
        ]
      ],
      "dependencies": []
    }
  ]
}
