"""Native macOS Keychain access without secrets in process arguments."""
from __future__ import annotations

import ctypes


SERVICE = b"2DGameDevWorkbench.SpritePipeline"


def _security():
    library = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
    library.SecKeychainFindGenericPassword.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p)]
    library.SecKeychainFindGenericPassword.restype = ctypes.c_int32
    library.SecKeychainAddGenericPassword.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    library.SecKeychainAddGenericPassword.restype = ctypes.c_int32
    library.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    return library


def put(account: str, value: bytes) -> None:
    library = _security()
    encoded = account.encode("ascii")
    status = library.SecKeychainAddGenericPassword(None, len(SERVICE), SERVICE, len(encoded), encoded, len(value), value, None)
    if status != 0:
        raise RuntimeError("macOS Keychain write failed; unlock the login keychain and allow access")


def get(account: str) -> bytes:
    library = _security()
    encoded = account.encode("ascii")
    size = ctypes.c_uint32()
    data = ctypes.c_void_p()
    status = library.SecKeychainFindGenericPassword(None, len(SERVICE), SERVICE, len(encoded), encoded, ctypes.byref(size), ctypes.byref(data), None)
    if status != 0:
        raise RuntimeError("macOS Keychain read failed; unlock the login keychain and allow access")
    try:
        return ctypes.string_at(data, size.value)
    finally:
        library.SecKeychainItemFreeContent(None, data)


def delete(account: str) -> None:
    library = _security()
    encoded = account.encode("ascii")
    item = ctypes.c_void_p()
    status = library.SecKeychainFindGenericPassword(None, len(SERVICE), SERVICE, len(encoded), encoded, None, None, ctypes.byref(item))
    if status == -25300:  # errSecItemNotFound
        return
    if status != 0:
        raise RuntimeError("macOS Keychain lookup failed")
    core = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    core.CFRelease.argtypes = [ctypes.c_void_p]
    library.SecKeychainItemDelete.argtypes = [ctypes.c_void_p]
    library.SecKeychainItemDelete.restype = ctypes.c_int32
    try:
        if library.SecKeychainItemDelete(item) != 0:
            raise RuntimeError("macOS Keychain delete failed")
    finally:
        core.CFRelease(item)
