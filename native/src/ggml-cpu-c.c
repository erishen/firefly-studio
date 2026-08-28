// 包装文件：解决 ggml-cpu.c 与 ggml-cpu.cpp 同名导致 node-gyp 只编译一个的问题。
#include "../whisper.cpp/ggml/src/ggml-cpu/ggml-cpu.c"
