using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

[assembly: AssemblyTitle("玄念全盘查找初始化")]
[assembly: AssemblyDescription("玄念全盘查找索引服务初始化")]
[assembly: AssemblyCompany("玄念")]
[assembly: AssemblyProduct("玄念")]
[assembly: AssemblyCopyright("Copyright © 玄念")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class XuanNianSearchSetup
{
    private const string InstallCommand = "--install-service-base64";
    private const string ExpectedInstance = "XuanNianSearch";
    private const string ExpectedEverythingSha256 = "f191f756996a14a11e5445fa7103d302efd510cf2fbf920e6c0c8ed51d512e36";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args == null || args.Length != 3 || !string.Equals(args[0], InstallCommand, StringComparison.Ordinal)) return 64;
        if (!string.Equals(args[2], ExpectedInstance, StringComparison.Ordinal)) return 65;
        if (!IsAdministrator()) return 740;

        try
        {
            string enginePath = Path.GetFullPath(Encoding.UTF8.GetString(Convert.FromBase64String(args[1])));
            if (!string.Equals(Path.GetFileName(enginePath), "Everything.exe", StringComparison.OrdinalIgnoreCase)) return 66;
            if (!File.Exists(enginePath) || !string.Equals(Sha256File(enginePath), ExpectedEverythingSha256, StringComparison.OrdinalIgnoreCase)) return 67;

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = enginePath,
                Arguments = "-instance \"" + ExpectedInstance + "\" -install-service",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using (Process process = Process.Start(startInfo))
            {
                if (process == null) return 68;
                if (!process.WaitForExit(30000))
                {
                    try { process.Kill(); }
                    catch { }
                    return 1460;
                }
                return process.ExitCode;
            }
        }
        catch
        {
            return 1;
        }
    }

    private static bool IsAdministrator()
    {
        try
        {
            WindowsPrincipal principal = new WindowsPrincipal(WindowsIdentity.GetCurrent());
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    private static string Sha256File(string filePath)
    {
        using (FileStream stream = File.OpenRead(filePath))
        using (SHA256 algorithm = SHA256.Create())
        {
            byte[] hash = algorithm.ComputeHash(stream);
            StringBuilder builder = new StringBuilder(hash.Length * 2);
            foreach (byte value in hash) builder.Append(value.ToString("x2"));
            return builder.ToString();
        }
    }
}
