#include <windows.h>

#include <iostream>
#include <string>

using ConnectFn = int(__cdecl*)(const wchar_t*, int);
using DisconnectFn = void(__cdecl*)(int);
using DisplayIdFn = int(__cdecl*)(int, const char*, int);
using TouchDownFn = int(__cdecl*)(int, int, int, int);
using TouchUpFn = int(__cdecl*)(int, int);
using FingerDownFn = int(__cdecl*)(int, int, int, int, int);
using FingerUpFn = int(__cdecl*)(int, int, int);

template <typename T>
T load_function(HMODULE module, const char* name)
{
    auto address = GetProcAddress(module, name);
    if (!address) {
        std::cerr << "missing export: " << name << "\n";
        std::exit(2);
    }
    return reinterpret_cast<T>(address);
}

int main(int argc, char** argv)
{
    if (argc != 5) {
        std::cerr << "usage: mumu_native_probe.exe X Y basic|finger hold_ms\n";
        return 2;
    }

    const int x = std::stoi(argv[1]);
    const int y = std::stoi(argv[2]);
    const bool basic = std::string(argv[3]) == "basic";
    const int hold_ms = std::stoi(argv[4]);
    const wchar_t* root = L"E:\\Program Files\\Netease\\MuMuPlayer-12.0";
    const char* package_name = "com.netease.onmyoji.wyzymnqsd_cps";
    const wchar_t* dll_path = L"E:\\Program Files\\Netease\\MuMuPlayer-12.0\\nx_device\\15.0\\shell\\sdk\\external_renderer_ipc.dll";

    HMODULE module = LoadLibraryW(dll_path);
    if (!module) {
        std::cerr << "LoadLibrary failed: " << GetLastError() << "\n";
        return 2;
    }

    auto connect = load_function<ConnectFn>(module, "nemu_connect");
    auto disconnect = load_function<DisconnectFn>(module, "nemu_disconnect");
    auto get_display_id = load_function<DisplayIdFn>(module, "nemu_get_display_id");
    auto handle = connect(root, 0);
    if (!handle) {
        std::cerr << "nemu_connect failed\n";
        FreeLibrary(module);
        return 3;
    }

    const int display_id = get_display_id(handle, package_name, 0);
    std::cout << "handle=" << handle << " display_id=" << display_id << " x=" << x << " y=" << y
              << " api=" << (basic ? "basic" : "finger") << " hold_ms=" << hold_ms << "\n";

    int down_result = 0;
    int up_result = 0;
    if (basic) {
        auto down = load_function<TouchDownFn>(module, "nemu_input_event_touch_down");
        auto up = load_function<TouchUpFn>(module, "nemu_input_event_touch_up");
        down_result = down(handle, display_id, x, y);
        Sleep(static_cast<DWORD>(hold_ms));
        up_result = up(handle, display_id);
    }
    else {
        auto down = load_function<FingerDownFn>(module, "nemu_input_event_finger_touch_down");
        auto up = load_function<FingerUpFn>(module, "nemu_input_event_finger_touch_up");
        down_result = down(handle, display_id, 1, x, y);
        Sleep(static_cast<DWORD>(hold_ms));
        up_result = up(handle, display_id, 1);
    }

    std::cout << "down=" << down_result << " up=" << up_result << "\n";
    disconnect(handle);
    FreeLibrary(module);
    return down_result == 0 && up_result == 0 ? 0 : 4;
}
