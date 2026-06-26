using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class XuanNianClipboardHelper
{
    [DllImport("user32.dll")]
    private static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")]
    private static extern int GetMessage(out NativeMessage message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref NativeMessage message);
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref NativeMessage message);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterClipboardFormat(string lpszFormat);
    [DllImport("ole32.dll")]
    private static extern int OleGetClipboard(out System.Runtime.InteropServices.ComTypes.IDataObject dataObject);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalLock(IntPtr hMem);
    [DllImport("kernel32.dll")]
    private static extern bool GlobalUnlock(IntPtr hMem);
    [DllImport("kernel32.dll")]
    private static extern UIntPtr GlobalSize(IntPtr hMem);
    [DllImport("ole32.dll")]
    private static extern void ReleaseStgMedium(ref System.Runtime.InteropServices.ComTypes.STGMEDIUM pmedium);

    private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);
    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_RBUTTONUP = 0x0205;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_MBUTTONUP = 0x0208;
    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12;
    private const int VK_SHIFT = 0x10;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private static readonly LowLevelProc KeyboardProc = KeyboardHookCallback;
    private static readonly LowLevelProc MouseProc = MouseHookCallback;
    private static IntPtr KeyboardHookId = IntPtr.Zero;
    private static IntPtr MouseHookId = IntPtr.Zero;
    private static string HotkeyQuick = "";
    private static string HotkeyScreenshot = "";
    private static string HotkeySticky = "";
    private static string MouseQuick = "";
    private static string MouseScreenshot = "";
    private static string MouseSticky = "";
    private static string LastHotkeyAction = "";
    private static int LastHotkeyTick = 0;
    private static bool SuppressLeftUp = false;
    private static bool SuppressRightUp = false;
    private static bool SuppressMiddleUp = false;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage
    {
        public IntPtr HWnd;
        public uint Value;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public NativePoint Position;
        public uint Private;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardEvent
    {
        public int VkCode;
        public int ScanCode;
        public int Flags;
        public int Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseEvent
    {
        public NativePoint Point;
        public int MouseData;
        public int Flags;
        public int Time;
        public IntPtr ExtraInfo;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length > 0 && String.Equals(args[0], "watch", StringComparison.OrdinalIgnoreCase))
            {
                WatchClipboard();
                return 0;
            }

            if (args.Length > 0 && String.Equals(args[0], "hotkeys", StringComparison.OrdinalIgnoreCase))
            {
                RunHotkeyHooks(args);
                return 0;
            }

            if (args.Length > 1 && String.Equals(args[0], "write-files", StringComparison.OrdinalIgnoreCase))
            {
                return WriteFiles(args);
            }

            if (args.Length > 0 && String.Equals(args[0], "sequence", StringComparison.OrdinalIgnoreCase))
            {
                Console.Write(GetClipboardSequenceNumber());
                return 0;
            }

            if (args.Length > 0 && String.Equals(args[0], "read-files", StringComparison.OrdinalIgnoreCase))
            {
                return WriteFileSnapshot();
            }

            if (args.Length > 0 && String.Equals(args[0], "foreground", StringComparison.OrdinalIgnoreCase))
            {
                Console.Write(GetForegroundWindow().ToInt64());
                return 0;
            }

            if (args.Length > 1 && String.Equals(args[0], "activate", StringComparison.OrdinalIgnoreCase))
            {
                Console.Write(ActivateWindow(args[1]) ? "True" : "False");
                return 0;
            }

            if (args.Length > 0 && String.Equals(args[0], "paste", StringComparison.OrdinalIgnoreCase))
            {
                PasteShortcut(args.Length > 1 ? args[1] : null);
                return 0;
            }

        }
        catch
        {
            return 1;
        }

        return 2;
    }

    private static bool ActivateWindow(string rawHandle)
    {
        long value;
        if (!Int64.TryParse(rawHandle ?? String.Empty, out value) || value == 0)
        {
            return false;
        }

        IntPtr hwnd = new IntPtr(value);
        if (IsIconic(hwnd))
        {
            ShowWindowAsync(hwnd, 9);
            Thread.Sleep(45);
        }
        BringWindowToTop(hwnd);
        Thread.Sleep(12);
        return SetForegroundWindow(hwnd);
    }

    private static void PasteShortcut(string rawHandle)
    {
        if (!String.IsNullOrWhiteSpace(rawHandle))
        {
            ActivateWindow(rawHandle);
            Thread.Sleep(30);
        }
        const int KEYUP = 2;
        keybd_event(0x11, 0, 0, 0);
        Thread.Sleep(5);
        keybd_event(0x56, 0, 0, 0);
        Thread.Sleep(5);
        keybd_event(0x56, 0, KEYUP, 0);
        Thread.Sleep(5);
        keybd_event(0x11, 0, KEYUP, 0);
    }

    private static void RunHotkeyHooks(string[] args)
    {
        HotkeyQuick = args.Length > 1 ? args[1] ?? "" : "";
        HotkeyScreenshot = args.Length > 2 ? args[2] ?? "" : "";
        HotkeySticky = args.Length > 3 ? args[3] ?? "" : "";
        MouseQuick = args.Length > 4 ? args[4] ?? "" : "";
        MouseScreenshot = args.Length > 5 ? args[5] ?? "" : "";
        MouseSticky = args.Length > 6 ? args[6] ?? "" : "";

        using (Process process = Process.GetCurrentProcess())
        using (ProcessModule module = process.MainModule)
        {
            IntPtr moduleHandle = GetModuleHandle(module.ModuleName);
            if (!String.IsNullOrEmpty(HotkeyQuick) || !String.IsNullOrEmpty(HotkeyScreenshot) || !String.IsNullOrEmpty(HotkeySticky))
            {
                KeyboardHookId = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardProc, moduleHandle, 0);
            }
            MouseHookId = SetWindowsHookEx(WH_MOUSE_LL, MouseProc, moduleHandle, 0);
        }

        if ((!String.IsNullOrEmpty(HotkeyQuick) || !String.IsNullOrEmpty(HotkeyScreenshot) || !String.IsNullOrEmpty(HotkeySticky)) && KeyboardHookId == IntPtr.Zero)
        {
            Environment.Exit(2);
        }
        if (MouseHookId == IntPtr.Zero)
        {
            Environment.Exit(3);
        }

        Console.WriteLine("READY");
        Console.Out.Flush();
        NativeMessage message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }

        if (KeyboardHookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(KeyboardHookId);
            KeyboardHookId = IntPtr.Zero;
        }
        if (MouseHookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(MouseHookId);
            MouseHookId = IntPtr.Zero;
        }
    }

    private static bool KeyDown(int key)
    {
        return (GetAsyncKeyState(key) & 0x8000) != 0;
    }

    private static string KeyName(int vk)
    {
        if (vk >= 0x30 && vk <= 0x39) return ((char)vk).ToString();
        if (vk >= 0x41 && vk <= 0x5A) return ((char)vk).ToString();
        if (vk >= 0x70 && vk <= 0x87) return "F" + (vk - 0x6F).ToString();
        switch (vk)
        {
            case 0x08: return "Backspace";
            case 0x09: return "Tab";
            case 0x0D: return "Enter";
            case 0x1B: return "Escape";
            case 0x20: return "Space";
            case 0x21: return "PageUp";
            case 0x22: return "PageDown";
            case 0x23: return "End";
            case 0x24: return "Home";
            case 0x25: return "ArrowLeft";
            case 0x26: return "ArrowUp";
            case 0x27: return "ArrowRight";
            case 0x28: return "ArrowDown";
            case 0x2D: return "Insert";
            case 0x2E: return "Delete";
            default: return "";
        }
    }

    private static string KeyboardCombo(int vk)
    {
        string key = KeyName(vk);
        if (String.IsNullOrEmpty(key)) return "";
        var parts = new List<string>();
        if (KeyDown(VK_CONTROL)) parts.Add("Ctrl");
        if (KeyDown(VK_LWIN) || KeyDown(VK_RWIN)) parts.Add("Meta");
        if (KeyDown(VK_MENU)) parts.Add("Alt");
        if (KeyDown(VK_SHIFT)) parts.Add("Shift");
        parts.Add(key);
        return String.Join("+", parts.ToArray());
    }

    private static string MouseCombo(string mouse)
    {
        var parts = new List<string>();
        if (KeyDown(VK_CONTROL)) parts.Add("Ctrl");
        if (KeyDown(VK_LWIN) || KeyDown(VK_RWIN)) parts.Add("Meta");
        if (KeyDown(VK_MENU)) parts.Add("Alt");
        if (KeyDown(VK_SHIFT)) parts.Add("Shift");
        parts.Add(mouse);
        return String.Join("+", parts.ToArray());
    }

    private static bool EmitHotkey(string action)
    {
        int now = Environment.TickCount;
        if (action == LastHotkeyAction && Math.Abs(now - LastHotkeyTick) < 260)
        {
            return true;
        }
        LastHotkeyAction = action;
        LastHotkeyTick = now;
        Console.WriteLine(action + "\t" + GetForegroundWindow().ToInt64());
        Console.Out.Flush();
        return true;
    }

    private static void EmitClick(MouseEvent evt)
    {
        Console.WriteLine("CLICK\t" + GetForegroundWindow().ToInt64() + "\t" + evt.Point.X + "\t" + evt.Point.Y);
        Console.Out.Flush();
    }

    private static IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        int message = wParam.ToInt32();
        if (nCode >= 0 && (message == WM_KEYDOWN || message == WM_SYSKEYDOWN))
        {
            KeyboardEvent evt = (KeyboardEvent)Marshal.PtrToStructure(lParam, typeof(KeyboardEvent));
            string combo = KeyboardCombo(evt.VkCode);
            if (!String.IsNullOrEmpty(combo))
            {
                if (!String.IsNullOrEmpty(HotkeyQuick) && combo == HotkeyQuick)
                {
                    EmitHotkey("QUICK");
                    return (IntPtr)1;
                }
                if (!String.IsNullOrEmpty(HotkeyScreenshot) && combo == HotkeyScreenshot)
                {
                    EmitHotkey("SCREENSHOT");
                    return (IntPtr)1;
                }
                if (!String.IsNullOrEmpty(HotkeySticky) && combo == HotkeySticky)
                {
                    EmitHotkey("STICKY");
                    return (IntPtr)1;
                }
            }
        }
        return CallNextHookEx(KeyboardHookId, nCode, wParam, lParam);
    }

    private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        int message = wParam.ToInt32();
        if (nCode >= 0)
        {
            if (message == WM_LBUTTONUP && SuppressLeftUp)
            {
                SuppressLeftUp = false;
                return (IntPtr)1;
            }
            if (message == WM_RBUTTONUP && SuppressRightUp)
            {
                SuppressRightUp = false;
                return (IntPtr)1;
            }
            if (message == WM_MBUTTONUP && SuppressMiddleUp)
            {
                SuppressMiddleUp = false;
                return (IntPtr)1;
            }
            if (message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN || message == WM_MBUTTONDOWN)
            {
                MouseEvent evt = (MouseEvent)Marshal.PtrToStructure(lParam, typeof(MouseEvent));
                string mouse = message == WM_LBUTTONDOWN ? "MouseLeft" : (message == WM_RBUTTONDOWN ? "MouseRight" : "MouseMiddle");
                string combo = MouseCombo(mouse);
                if (!String.IsNullOrEmpty(MouseQuick) && combo == MouseQuick)
                {
                    SuppressMouseUp(mouse);
                    EmitHotkey("QUICK");
                    return (IntPtr)1;
                }
                if (!String.IsNullOrEmpty(MouseScreenshot) && combo == MouseScreenshot)
                {
                    SuppressMouseUp(mouse);
                    EmitHotkey("SCREENSHOT");
                    return (IntPtr)1;
                }
                if (!String.IsNullOrEmpty(MouseSticky) && combo == MouseSticky)
                {
                    SuppressMouseUp(mouse);
                    EmitHotkey("STICKY");
                    return (IntPtr)1;
                }
                EmitClick(evt);
            }
        }
        return CallNextHookEx(MouseHookId, nCode, wParam, lParam);
    }

    private static void SuppressMouseUp(string mouse)
    {
        if (mouse == "MouseLeft")
        {
            SuppressLeftUp = true;
        }
        else if (mouse == "MouseRight")
        {
            SuppressRightUp = true;
        }
        else
        {
            SuppressMiddleUp = true;
        }
    }

    private static void WatchClipboard()
    {
        uint lastSequence = GetClipboardSequenceNumber();
        Console.WriteLine("READY\t" + lastSequence);
        Console.Out.Flush();
        while (true)
        {
            Thread.Sleep(110);
            uint sequence = GetClipboardSequenceNumber();
            if (sequence == 0 || sequence == lastSequence)
            {
                continue;
            }

            lastSequence = sequence;
            Thread.Sleep(80);
            string snapshot = ReadSnapshot(sequence);
            if (String.IsNullOrEmpty(snapshot))
            {
                continue;
            }

            Console.WriteLine(snapshot);
            Console.Out.Flush();
        }
    }

    private static string ReadSnapshot(uint expectedSequence)
    {
        string bestSnapshot = null;
        for (int attempt = 0; attempt < 8; attempt++)
        {
            try
            {
                uint sequence = GetClipboardSequenceNumber();
                if (sequence != expectedSequence)
                {
                    expectedSequence = sequence;
                    bestSnapshot = null;
                }

                int dropEffect;
                List<string> paths = ReadFilePaths(out dropEffect);
                if (GetClipboardSequenceNumber() != expectedSequence)
                {
                    Thread.Sleep(35);
                    continue;
                }

                if (paths.Count > 0)
                {
                    var parts = new List<string>
                    {
                        expectedSequence.ToString(),
                        "files",
                        dropEffect.ToString()
                    };
                    foreach (string item in paths)
                    {
                        parts.Add(Convert.ToBase64String(Encoding.UTF8.GetBytes(item)));
                    }
                    string text = ReadClipboardText();
                    if (!String.IsNullOrWhiteSpace(text))
                    {
                        parts.Add("__TEXT64__=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
                    }
                    return String.Join("\t", parts.ToArray());
                }

                if (Clipboard.ContainsImage())
                {
                    string text = ReadClipboardText();
                    if (!String.IsNullOrWhiteSpace(text))
                    {
                        return expectedSequence + "\timage\t0\t__TEXT64__=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(text));
                    }
                    return expectedSequence + "\timage\t0";
                }

                if (Clipboard.ContainsData(DataFormats.Html))
                {
                    bestSnapshot = expectedSequence + "\ttext\t0";
                    if (attempt < 5)
                    {
                        Thread.Sleep(65);
                        continue;
                    }
                    return bestSnapshot;
                }

                if (Clipboard.ContainsText())
                {
                    bestSnapshot = expectedSequence + "\ttext\t0";
                    if (attempt < 2)
                    {
                        Thread.Sleep(45);
                        continue;
                    }
                    return bestSnapshot;
                }

                bestSnapshot = expectedSequence + "\tother\t0";
            }
            catch
            {
                Thread.Sleep(45);
            }
            Thread.Sleep(attempt < 3 ? 45 : 70);
        }

        return bestSnapshot;
    }

    private static string ReadClipboardText()
    {
        try
        {
            if (!Clipboard.ContainsText())
            {
                return null;
            }
            try
            {
                return Clipboard.GetText(TextDataFormat.UnicodeText);
            }
            catch
            {
                return Clipboard.GetText();
            }
        }
        catch
        {
            return null;
        }
    }

    private static List<string> ReadFilePaths(out int dropEffect)
    {
        dropEffect = 0;
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        IDataObject data = Clipboard.GetDataObject();
        if (data != null)
        {
            dropEffect = ReadDropEffect(data.GetData("Preferred DropEffect"));
        }

        StringCollection dropped = Clipboard.GetFileDropList();
        if (dropped != null && dropped.Count > 0)
        {
            foreach (string item in dropped)
            {
                AddPath(result, seen, item);
            }
            return result;
        }

        if (data == null)
        {
            return result;
        }

        foreach (string format in new[] { "FileNameW", "FileName" })
        {
            try
            {
                object value = data.GetData(format);
                Array array = value as Array;
                if (array != null)
                {
                    foreach (object item in array)
                    {
                        AddPath(result, seen, Convert.ToString(item));
                    }
                }
                else
                {
                    AddPath(result, seen, Convert.ToString(value));
                }
            }
            catch
            {
            }
        }

        if (result.Count == 0)
        {
            ReadVirtualFiles(result, seen);
        }

        return result;
    }

    private static int WriteFileSnapshot()
    {
        int dropEffect;
        List<string> paths = ReadFilePaths(out dropEffect);
        Console.WriteLine("__DROPEFFECT__=" + dropEffect);
        foreach (string item in paths)
        {
            Console.WriteLine("__PATH64__=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(item)));
        }
        string text = ReadClipboardText();
        if (!String.IsNullOrWhiteSpace(text))
        {
            Console.WriteLine("__TEXT64__=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
        }
        Console.WriteLine("__SEQ__=" + GetClipboardSequenceNumber());
        return 0;
    }

    private static void ReadVirtualFiles(List<string> result, HashSet<string> seen)
    {
        System.Runtime.InteropServices.ComTypes.IDataObject dataObject = null;
        try
        {
            if (OleGetClipboard(out dataObject) != 0 || dataObject == null)
            {
                return;
            }

            List<string> names = ReadVirtualFileNames(dataObject);
            if (names.Count == 0)
            {
                return;
            }

            string targetDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "xuannian",
                "clipboard-virtual"
            );
            Directory.CreateDirectory(targetDir);

            for (int index = 0; index < names.Count; index++)
            {
                string safeName = SafeFileName(names[index]);
                if (String.IsNullOrWhiteSpace(safeName))
                {
                    safeName = "clipboard-file-" + (index + 1);
                }
                string targetPath = UniqueVirtualFilePath(targetDir, safeName);
                if (TryWriteVirtualFile(dataObject, index, targetPath))
                {
                    AddPath(result, seen, targetPath);
                }
            }
        }
        catch
        {
        }
        finally
        {
            if (dataObject != null && Marshal.IsComObject(dataObject))
            {
                try { Marshal.ReleaseComObject(dataObject); } catch { }
            }
        }
    }

    private static List<string> ReadVirtualFileNames(System.Runtime.InteropServices.ComTypes.IDataObject dataObject)
    {
        var result = new List<string>();
        uint formatId = RegisterClipboardFormat("FileGroupDescriptorW");
        if (formatId == 0)
        {
            return result;
        }

        var format = new System.Runtime.InteropServices.ComTypes.FORMATETC
        {
            cfFormat = unchecked((short)formatId),
            dwAspect = System.Runtime.InteropServices.ComTypes.DVASPECT.DVASPECT_CONTENT,
            lindex = -1,
            tymed = System.Runtime.InteropServices.ComTypes.TYMED.TYMED_HGLOBAL
        };
        System.Runtime.InteropServices.ComTypes.STGMEDIUM medium = new System.Runtime.InteropServices.ComTypes.STGMEDIUM();
        try
        {
            dataObject.GetData(ref format, out medium);
            IntPtr pointer = GlobalLock(medium.unionmember);
            if (pointer == IntPtr.Zero)
            {
                return result;
            }
            try
            {
                int count = Marshal.ReadInt32(pointer);
                const int descriptorSize = 592;
                const int fileNameOffset = 72;
                for (int index = 0; index < count; index++)
                {
                    IntPtr descriptor = IntPtr.Add(pointer, 4 + index * descriptorSize + fileNameOffset);
                    string name = Marshal.PtrToStringUni(descriptor, 260);
                    if (!String.IsNullOrWhiteSpace(name))
                    {
                        result.Add(name.TrimEnd('\0'));
                    }
                }
            }
            finally
            {
                GlobalUnlock(medium.unionmember);
            }
        }
        catch
        {
        }
        finally
        {
            try { ReleaseStgMedium(ref medium); } catch { }
        }
        return result;
    }

    private static bool TryWriteVirtualFile(System.Runtime.InteropServices.ComTypes.IDataObject dataObject, int index, string targetPath)
    {
        uint formatId = RegisterClipboardFormat("FileContents");
        if (formatId == 0)
        {
            return false;
        }

        var format = new System.Runtime.InteropServices.ComTypes.FORMATETC
        {
            cfFormat = unchecked((short)formatId),
            dwAspect = System.Runtime.InteropServices.ComTypes.DVASPECT.DVASPECT_CONTENT,
            lindex = index,
            tymed = System.Runtime.InteropServices.ComTypes.TYMED.TYMED_ISTREAM | System.Runtime.InteropServices.ComTypes.TYMED.TYMED_HGLOBAL
        };
        System.Runtime.InteropServices.ComTypes.STGMEDIUM medium = new System.Runtime.InteropServices.ComTypes.STGMEDIUM();
        try
        {
            dataObject.GetData(ref format, out medium);
            if (medium.tymed == System.Runtime.InteropServices.ComTypes.TYMED.TYMED_ISTREAM)
            {
                var stream = (System.Runtime.InteropServices.ComTypes.IStream)Marshal.GetObjectForIUnknown(medium.unionmember);
                using (var output = File.Create(targetPath))
                {
                    CopyComStream(stream, output);
                }
                return File.Exists(targetPath);
            }
            if (medium.tymed == System.Runtime.InteropServices.ComTypes.TYMED.TYMED_HGLOBAL)
            {
                IntPtr pointer = GlobalLock(medium.unionmember);
                if (pointer == IntPtr.Zero)
                {
                    return false;
                }
                try
                {
                    long size = unchecked((long)GlobalSize(medium.unionmember).ToUInt64());
                    if (size <= 0 || size > Int32.MaxValue)
                    {
                        return false;
                    }
                    byte[] bytes = new byte[size];
                    Marshal.Copy(pointer, bytes, 0, bytes.Length);
                    File.WriteAllBytes(targetPath, bytes);
                    return true;
                }
                finally
                {
                    GlobalUnlock(medium.unionmember);
                }
            }
        }
        catch
        {
            try { if (File.Exists(targetPath)) File.Delete(targetPath); } catch { }
        }
        finally
        {
            try { ReleaseStgMedium(ref medium); } catch { }
        }
        return false;
    }

    private static void CopyComStream(System.Runtime.InteropServices.ComTypes.IStream stream, Stream output)
    {
        byte[] buffer = new byte[1024 * 64];
        IntPtr bytesReadPtr = Marshal.AllocHGlobal(sizeof(int));
        try
        {
            while (true)
            {
                Marshal.WriteInt32(bytesReadPtr, 0);
                stream.Read(buffer, buffer.Length, bytesReadPtr);
                int bytesRead = Marshal.ReadInt32(bytesReadPtr);
                if (bytesRead <= 0)
                {
                    break;
                }
                output.Write(buffer, 0, bytesRead);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(bytesReadPtr);
        }
    }

    private static string SafeFileName(string value)
    {
        string fileName = Path.GetFileName(value ?? String.Empty);
        foreach (char item in Path.GetInvalidFileNameChars())
        {
            fileName = fileName.Replace(item, '_');
        }
        return fileName.Trim();
    }

    private static string UniqueVirtualFilePath(string folder, string fileName)
    {
        string name = Path.GetFileNameWithoutExtension(fileName);
        string ext = Path.GetExtension(fileName);
        string stamp = DateTime.Now.ToString("yyyyMMddHHmmssfff");
        string candidate = Path.Combine(folder, name + "-" + stamp + ext);
        int index = 1;
        while (File.Exists(candidate) || Directory.Exists(candidate))
        {
            candidate = Path.Combine(folder, name + "-" + stamp + "-" + index + ext);
            index++;
        }
        return candidate;
    }

    private static void AddPath(List<string> result, HashSet<string> seen, string value)
    {
        if (String.IsNullOrWhiteSpace(value))
        {
            return;
        }

        try
        {
            string fullPath = Path.GetFullPath(value.Trim());
            if (!File.Exists(fullPath) && !Directory.Exists(fullPath))
            {
                return;
            }

            if (seen.Add(fullPath))
            {
                result.Add(fullPath);
            }
        }
        catch
        {
        }
    }

    private static int ReadDropEffect(object value)
    {
        try
        {
            var stream = value as MemoryStream;
            if (stream != null)
            {
                byte[] bytes = stream.ToArray();
                return bytes.Length >= 4 ? BitConverter.ToInt32(bytes, 0) : 0;
            }

            byte[] array = value as byte[];
            if (array != null && array.Length >= 4)
            {
                return BitConverter.ToInt32(array, 0);
            }

            if (value is int)
            {
                return (int)value;
            }
        }
        catch
        {
        }

        return 0;
    }

    private static int WriteFiles(string[] args)
    {
        string action = args[1];
        var paths = new StringCollection();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        string text = null;
        bool richImage = false;
        for (int index = 2; index < args.Length; index++)
        {
            try
            {
                if (String.Equals(args[index], "--rich-image", StringComparison.OrdinalIgnoreCase))
                {
                    richImage = true;
                    continue;
                }

                if (String.Equals(args[index], "--text", StringComparison.OrdinalIgnoreCase) && index + 1 < args.Length)
                {
                    text = Encoding.UTF8.GetString(Convert.FromBase64String(args[++index]));
                    continue;
                }

                string decoded = Encoding.UTF8.GetString(Convert.FromBase64String(args[index]));
                string fullPath = Path.GetFullPath(decoded);
                if ((File.Exists(fullPath) || Directory.Exists(fullPath)) && seen.Add(fullPath))
                {
                    paths.Add(fullPath);
                }
            }
            catch
            {
            }
        }

        if (paths.Count == 0)
        {
            return 3;
        }

        var data = new DataObject();
        data.SetFileDropList(paths);
        if (!String.IsNullOrWhiteSpace(text))
        {
            data.SetText(text, TextDataFormat.UnicodeText);
            data.SetText(text, TextDataFormat.Text);
            data.SetData(DataFormats.Html, HtmlClipboardFormat(text, paths));
        }
        if (richImage)
        {
            try
            {
                using (Image image = Image.FromFile(paths[0]))
                {
                    data.SetImage(new Bitmap(image));
                }
            }
            catch
            {
            }
        }
        int effect = String.Equals(action, "cut", StringComparison.OrdinalIgnoreCase) ? 2 : 1;
        byte[] bytes = BitConverter.GetBytes(effect);
        var stream = new MemoryStream();
        stream.Write(bytes, 0, bytes.Length);
        stream.Position = 0;
        data.SetData("Preferred DropEffect", stream);

        Clipboard.Clear();
        Clipboard.SetDataObject(data, true, 8, 35);
        Thread.Sleep(30);
        Console.Write("OK\t" + GetClipboardSequenceNumber());
        return 0;
    }

    private static string HtmlClipboardFormat(string text, StringCollection paths)
    {
        string escaped = HtmlEscape(text).Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "<br>");
        var fragment = new StringBuilder();
        if (!String.IsNullOrWhiteSpace(escaped))
        {
            fragment.Append("<div>").Append(escaped).Append("</div>");
        }
        if (paths != null)
        {
            foreach (string filePath in paths)
            {
                if (IsImagePath(filePath))
                {
                    fragment.Append("<div><img src=\"")
                        .Append(HtmlEscape(PathToFileUri(filePath)))
                        .Append("\" /></div>");
                }
                else
                {
                    fragment.Append("<div><a href=\"")
                        .Append(HtmlEscape(PathToFileUri(filePath)))
                        .Append("\">")
                        .Append(HtmlEscape(Path.GetFileName(filePath)))
                        .Append("</a></div>");
                }
            }
        }
        string html = "<html><body><!--StartFragment-->" + fragment + "<!--EndFragment--></body></html>";
        const string headerTemplate = "Version:0.9\r\nStartHTML:{0:D10}\r\nEndHTML:{1:D10}\r\nStartFragment:{2:D10}\r\nEndFragment:{3:D10}\r\n";
        string header = String.Format(headerTemplate, 0, 0, 0, 0);
        int startHtml = Encoding.UTF8.GetByteCount(header);
        int startFragment = startHtml + Encoding.UTF8.GetByteCount("<html><body><!--StartFragment-->");
        int endFragment = startFragment + Encoding.UTF8.GetByteCount(fragment.ToString());
        int endHtml = startHtml + Encoding.UTF8.GetByteCount(html);
        header = String.Format(headerTemplate, startHtml, endHtml, startFragment, endFragment);
        return header + html;
    }

    private static bool IsImagePath(string filePath)
    {
        string ext = Path.GetExtension(filePath ?? String.Empty).ToLowerInvariant();
        return ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".gif" || ext == ".webp" || ext == ".bmp";
    }

    private static string PathToFileUri(string filePath)
    {
        return new Uri(Path.GetFullPath(filePath)).AbsoluteUri;
    }

    private static string HtmlEscape(string value)
    {
        return (value ?? String.Empty)
            .Replace("&", "&amp;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;")
            .Replace("\"", "&quot;");
    }
}
