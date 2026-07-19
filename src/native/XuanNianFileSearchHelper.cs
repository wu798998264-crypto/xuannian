using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class XuanNianFileSearchHelper
{
    private const int WM_COPYDATA = 0x004A;
    private const int WM_CLOSE = 0x0010;
    private const int Query2Unicode = 18;
    private const uint RequestName = 0x00000001;
    private const uint RequestPath = 0x00000002;
    private const uint RequestSize = 0x00000010;
    private const uint RequestDateModified = 0x00000040;
    private const uint RequestAttributes = 0x00000100;
    private const uint FileAttributeDirectory = 0x00000010;
    private const int QueryHeaderBytes = 28;
    private const int ListHeaderBytes = 20;
    private const int ItemBytes = 8;
    private static readonly DateTime UnixEpoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    [StructLayout(LayoutKind.Sequential)]
    private struct CopyDataStruct
    {
        public IntPtr dwData;
        public int cbData;
        public IntPtr lpData;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, ref CopyDataStruct lParam);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    private sealed class ResultItem
    {
        public string path { get; set; }
        public string name { get; set; }
        public string directory { get; set; }
        public string kind { get; set; }
        public long? size { get; set; }
        public long? modifiedAt { get; set; }
    }

    private sealed class ResultPayload
    {
        public int total { get; set; }
        public int elapsedMs { get; set; }
        public List<ResultItem> results { get; set; }
    }

    private sealed class SearchWindow : NativeWindow
    {
        private readonly Dictionary<uint, long> startedAt = new Dictionary<uint, long>();
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private readonly object outputLock = new object();

        public SearchWindow()
        {
            CreateHandle(new CreateParams { Caption = "XuanNian File Search IPC" });
        }

        public void Remember(uint requestId, long timestamp)
        {
            lock (startedAt)
            {
                startedAt.Clear();
                startedAt[requestId] = timestamp;
            }
        }

        public void Forget(uint requestId)
        {
            lock (startedAt) startedAt.Remove(requestId);
        }

        private long TakeStartedAt(uint requestId)
        {
            lock (startedAt)
            {
                long value;
                if (!startedAt.TryGetValue(requestId, out value)) return Stopwatch.GetTimestamp();
                startedAt.Remove(requestId);
                return value;
            }
        }

        private void WriteResponse(string prefix, uint requestId, string value)
        {
            string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? string.Empty));
            lock (outputLock)
            {
                Console.WriteLine(prefix + "\t" + requestId + "\t" + encoded);
                Console.Out.Flush();
            }
        }

        public void WriteError(uint requestId, string message)
        {
            WriteResponse("E", requestId, message);
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WM_CLOSE)
            {
                DestroyHandle();
                Application.ExitThread();
                return;
            }
            if (message.Msg == WM_COPYDATA)
            {
                CopyDataStruct data = (CopyDataStruct)Marshal.PtrToStructure(message.LParam, typeof(CopyDataStruct));
                uint requestId = unchecked((uint)data.dwData.ToInt64());
                try
                {
                    ResultPayload payload = ParseResults(data.lpData, data.cbData, TakeStartedAt(requestId));
                    WriteResponse("R", requestId, serializer.Serialize(payload));
                }
                catch (Exception error)
                {
                    WriteError(requestId, error.Message);
                }
                message.Result = new IntPtr(1);
                return;
            }
            base.WndProc(ref message);
        }

        private static ResultPayload ParseResults(IntPtr pointer, int byteLength, long started)
        {
            if (pointer == IntPtr.Zero || byteLength < ListHeaderBytes) throw new InvalidDataException("搜索结果格式无效");
            int total = unchecked((int)(uint)Marshal.ReadInt32(pointer, 0));
            int count = unchecked((int)(uint)Marshal.ReadInt32(pointer, 4));
            uint requestFlags = unchecked((uint)Marshal.ReadInt32(pointer, 12));
            if (count < 0 || count > 100000 || ListHeaderBytes + count * ItemBytes > byteLength) throw new InvalidDataException("搜索结果数量无效");
            List<ResultItem> results = new List<ResultItem>(count);
            for (int index = 0; index < count; index++)
            {
                int itemOffset = ListHeaderBytes + index * ItemBytes;
                uint flags = unchecked((uint)Marshal.ReadInt32(pointer, itemOffset));
                int dataOffset = unchecked((int)(uint)Marshal.ReadInt32(pointer, itemOffset + 4));
                if (dataOffset < 0 || dataOffset >= byteLength) continue;
                IntPtr cursor = IntPtr.Add(pointer, dataOffset);
                string name = ReadText(ref cursor, requestFlags, RequestName);
                string directory = ReadText(ref cursor, requestFlags, RequestPath);
                long? size = null;
                if ((requestFlags & RequestSize) != 0)
                {
                    size = Marshal.ReadInt64(cursor);
                    cursor = IntPtr.Add(cursor, 8);
                }
                long? modifiedAt = null;
                if ((requestFlags & RequestDateModified) != 0)
                {
                    long fileTime = Marshal.ReadInt64(cursor);
                    cursor = IntPtr.Add(cursor, 8);
                    if (fileTime > 0)
                    {
                        try { modifiedAt = (long)(DateTime.FromFileTimeUtc(fileTime) - UnixEpoch).TotalMilliseconds; }
                        catch { modifiedAt = null; }
                    }
                }
                uint attributes = 0;
                if ((requestFlags & RequestAttributes) != 0) attributes = unchecked((uint)Marshal.ReadInt32(cursor));
                bool isFolder = (attributes & FileAttributeDirectory) != 0 || (flags & 0x00000001) != 0;
                string fullPath = string.IsNullOrEmpty(directory) ? name : Path.Combine(directory, name);
                results.Add(new ResultItem
                {
                    path = fullPath,
                    name = name,
                    directory = directory,
                    kind = isFolder ? "folder" : "file",
                    size = isFolder ? null : size,
                    modifiedAt = modifiedAt,
                });
            }
            double elapsed = (Stopwatch.GetTimestamp() - started) * 1000.0 / Stopwatch.Frequency;
            return new ResultPayload { total = total, elapsedMs = Math.Max(0, (int)Math.Round(elapsed)), results = results };
        }

        private static string ReadText(ref IntPtr cursor, uint flags, uint flag)
        {
            if ((flags & flag) == 0) return string.Empty;
            int length = unchecked((int)(uint)Marshal.ReadInt32(cursor));
            cursor = IntPtr.Add(cursor, 4);
            if (length < 0 || length > 32768) throw new InvalidDataException("搜索结果文本长度无效");
            string value = length == 0 ? string.Empty : (Marshal.PtrToStringUni(cursor, length) ?? string.Empty);
            cursor = IntPtr.Add(cursor, checked((length + 1) * 2));
            return value;
        }
    }

    [STAThread]
    private static void Main()
    {
        SearchWindow window = new SearchWindow();
        Thread inputThread = new Thread(delegate() { ReadCommands(window); });
        inputThread.IsBackground = true;
        inputThread.Name = "XuanNian file search input";
        inputThread.Start();
        Console.WriteLine("READY");
        Console.Out.Flush();
        Application.Run();
    }

    private static void ReadCommands(SearchWindow replyWindow)
    {
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            if (line == "EXIT")
            {
                PostMessage(replyWindow.Handle, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                return;
            }
            string[] fields = line.Split('\t');
            uint requestId;
            if (fields.Length < 8 || fields[0] != "Q" || !uint.TryParse(fields[1], out requestId)) continue;
            try
            {
                string instance = Decode(fields[2]);
                string query = Decode(fields[3]);
                string type = fields[4];
                string sort = fields[5];
                string direction = fields[6];
                uint limit;
                if (!uint.TryParse(fields[7], out limit)) limit = 300;
                SendQuery(replyWindow, requestId, instance, query, type, sort, direction, Math.Max(1, Math.Min(2000, limit)));
            }
            catch (Exception error)
            {
                replyWindow.WriteError(requestId, error.Message);
            }
        }
        PostMessage(replyWindow.Handle, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    }

    private static string Decode(string value)
    {
        return Encoding.UTF8.GetString(Convert.FromBase64String(value ?? string.Empty));
    }

    private static uint SortValue(string sort, string direction)
    {
        bool descending = string.Equals(direction, "desc", StringComparison.OrdinalIgnoreCase);
        if (sort == "path") return descending ? 4u : 3u;
        if (sort == "size") return descending ? 6u : 5u;
        if (sort == "modified") return descending ? 14u : 13u;
        return descending ? 2u : 1u;
    }

    private static void SendQuery(SearchWindow replyWindow, uint requestId, string instance, string query, string type, string sort, string direction, uint limit)
    {
        string windowClass = "EVERYTHING_TASKBAR_NOTIFICATION";
        if (!string.IsNullOrEmpty(instance)) windowClass += "_(" + instance + ")";
        IntPtr everythingWindow = FindWindow(windowClass, null);
        if (everythingWindow == IntPtr.Zero)
        {
            replyWindow.WriteError(requestId, "文件索引进程未运行");
            return;
        }
        string search = query;
        if (type == "file") search = "file: " + search;
        else if (type == "folder") search = "folder: " + search;
        else if (type == "document") search = "ext:txt;md;markdown;rtf;pdf;doc;docx;docm;dot;dotx;dotm;odt;ott;wps;xls;xlsx;xlsm;xlsb;xlt;xltx;xltm;csv;ods;ots;et;ppt;pptx;pptm;pps;ppsx;pot;potx;odp;otp;dps;pages;numbers;key;epub;mobi;azw;azw3;tex;xps;djvu;chm " + search;
        else if (type == "image") search = "ext:jpg;jpeg;jpe;png;gif;bmp;webp;tif;tiff;ico;svg;heic;heif;avif;dng;raw;cr2;nef;arw " + search;
        else if (type == "video") search = "ext:mp4;m4v;mkv;mov;avi;wmv;flv;webm;mpeg;mpg;m2ts;mts;ts;3gp;rm;rmvb;vob;ogv " + search;
        else if (type == "audio") search = "ext:mp3;wav;flac;aac;m4a;ogg;oga;wma;ape;opus;aiff;aif;amr;mid;midi;alac " + search;
        byte[] searchBytes = Encoding.Unicode.GetBytes(search + "\0");
        int queryBytes = QueryHeaderBytes + searchBytes.Length;
        IntPtr queryPointer = Marshal.AllocHGlobal(queryBytes);
        try
        {
            Marshal.WriteInt32(queryPointer, 0, unchecked((int)replyWindow.Handle.ToInt64()));
            Marshal.WriteInt32(queryPointer, 4, unchecked((int)requestId));
            Marshal.WriteInt32(queryPointer, 8, 0);
            Marshal.WriteInt32(queryPointer, 12, 0);
            Marshal.WriteInt32(queryPointer, 16, unchecked((int)limit));
            Marshal.WriteInt32(queryPointer, 20, unchecked((int)(RequestName | RequestPath | RequestSize | RequestDateModified | RequestAttributes)));
            Marshal.WriteInt32(queryPointer, 24, unchecked((int)SortValue(sort, direction)));
            Marshal.Copy(searchBytes, 0, IntPtr.Add(queryPointer, QueryHeaderBytes), searchBytes.Length);
            CopyDataStruct copyData = new CopyDataStruct
            {
                dwData = new IntPtr(Query2Unicode),
                cbData = queryBytes,
                lpData = queryPointer,
            };
            replyWindow.Remember(requestId, Stopwatch.GetTimestamp());
            IntPtr sent = SendMessage(everythingWindow, WM_COPYDATA, replyWindow.Handle, ref copyData);
            if (sent == IntPtr.Zero)
            {
                replyWindow.Forget(requestId);
                replyWindow.WriteError(requestId, "文件索引拒绝了搜索请求");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(queryPointer);
        }
    }
}
