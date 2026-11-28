use std::ptr;
use windows_sys::Win32::{
    Foundation::HWND,
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Shell::SetCurrentProcessExplicitAppUserModelID,
        WindowsAndMessaging::{
            ICON_BIG, IMAGE_ICON, LR_DEFAULTSIZE, LR_SHARED, LoadImageW, SendMessageW, WM_SETICON,
        },
    },
};

pub(crate) fn set_app_id(identifier: &str) {
    let identifier: Vec<u16> = identifier.encode_utf16().chain([0]).collect();
    // Match the identifier on the Start menu shortcuts and existing taskbar pins.
    let status = unsafe { SetCurrentProcessExplicitAppUserModelID(identifier.as_ptr()) };
    if status < 0 {
        eprintln!("Failed to set the Windows app ID: {status:#x}");
    }
}

pub(crate) fn set_taskbar_icon(window: HWND) {
    let resource = tauri::utils::platform::WINDOWS_APP_ICON_RESOURCE_ID as usize as *const u16;
    // Use the embedded ICO at the system's large icon size. Windows owns the shared handle.
    unsafe {
        let executable = GetModuleHandleW(ptr::null());
        let icon = LoadImageW(
            executable,
            resource,
            IMAGE_ICON,
            0,
            0,
            LR_DEFAULTSIZE | LR_SHARED,
        );
        if !icon.is_null() {
            SendMessageW(window, WM_SETICON, ICON_BIG as usize, icon as isize);
        }
    }
}
