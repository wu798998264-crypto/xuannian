import AppKit
import CoreGraphics
import Foundation

// A disposable foreground application for the panel regression. It never
// accesses documents or uses Accessibility/Screen Recording permissions.
final class QuickPanelHost: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let statusPath: String
    let electronPid: Int32
    var window: NSWindow!
    var timer: Timer?
    var fullscreen = false

    init(statusPath: String, electronPid: Int32) {
        self.statusPath = statusPath
        self.electronPid = electronPid
        super.init()
    }

    func writeStatus(fullscreen: Bool) {
        self.fullscreen = fullscreen
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        let electronWindows = windows.filter {
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == electronPid
        }.compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value }
        let state: [String: Any] = [
            "pid": ProcessInfo.processInfo.processIdentifier,
            "fullscreen": fullscreen,
            "hostOnActiveSpace": window?.isOnActiveSpace ?? false,
            "electronOnScreenWindowIds": electronWindows,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: state) {
            try? data.write(to: URL(fileURLWithPath: statusPath), options: .atomic)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 480),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "XuanNian quick panel external application fixture"
        window.collectionBehavior = [.fullScreenPrimary]
        window.delegate = self
        let text = NSTextField(labelWithString: "External application stays in front while the quick panel accepts input.")
        text.frame = NSRect(x: 32, y: 210, width: 690, height: 50)
        window.contentView?.addSubview(text)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        writeStatus(fullscreen: false)
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.readCommand()
            if let self { self.writeStatus(fullscreen: self.fullscreen) }
        }
    }

    func readCommand() {
        let commandPath = statusPath + ".command"
        guard let command = try? String(contentsOfFile: commandPath, encoding: .utf8) else { return }
        try? FileManager.default.removeItem(atPath: commandPath)
        switch command.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "fullscreen":
            if !window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
        case "windowed":
            if window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
        case "quit":
            NSApp.terminate(nil)
        default:
            break
        }
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        writeStatus(fullscreen: true)
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        writeStatus(fullscreen: false)
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)
let delegate = QuickPanelHost(statusPath: CommandLine.arguments[1], electronPid: Int32(CommandLine.arguments[2])!)
application.delegate = delegate
application.run()
