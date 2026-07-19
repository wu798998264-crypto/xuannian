# 玄念

本地剪切板、收藏、置顶便签与全盘文件查找工具。收藏和附件继续使用稳定的数据目录，覆盖安装新版本不会删除已有数据。

## 下载

请在 [最新版本发布页](https://github.com/wu798998264-crypto/xuannian/releases/latest) 按设备选择：

- Windows 安装版：`XuanNian-版本号-Setup.exe`
- Windows 便携版：`XuanNian-版本号-Portable.exe`
- Apple silicon Mac（M1/M2/M3/M4）：`XuanNian-版本号-arm64.dmg`
- Intel Mac：`XuanNian-版本号-x64.dmg`

不要下载 `latest.yml`、`latest-mac.yml`、`blockmap` 文件；它们供自动更新使用。

## 全盘查找

第三个主板块可按名称或路径查找文件与文件夹，并支持类型筛选、排序、打开、定位和复制路径。默认快捷键为 `Ctrl+Alt+A`，可在设置中修改；截图默认快捷键相应调整为 `Ctrl+Alt+D`，原有自定义截图快捷键不会被覆盖。

Windows 首次启用会请求一次系统授权，用于安装本机文件索引服务。索引和查询均在本机完成，不读取或上传文件内容。macOS 直接使用系统 Spotlight 索引，无需额外安装服务。

Windows 版内含按 MIT License 再分发的 Everything 与 ES，许可证随安装资源一并提供。

## 版本规则

发布版本统一使用 `主版本.次版本.修订号`。次版本和修订号只能为 `0` 到 `9`：`x.y.9` 的下一版进位为 `x.(y+1).0`，`x.9.9` 的下一版进位为 `(x+1).0.0`，不再使用两位数的末级版本号。
