# 源码构建与 GitHub 发布说明

## 一、开发环境

建议准备 Node.js 22、npm、Git、Google Chrome 和 GitHub 账号。

```bash
node --version
npm --version
git --version
```

## 二、安装、构建和测试

```bash
npm ci
npm run build
npm run check
```

`npm ci` 会按照 `package-lock.json` 安装依赖；`npm run build` 生成 `dist/`；`npm run check` 执行权限、文件、远程接口和功能测试。

进入 `chrome://extensions`，开启开发者模式，点击“加载已解压的扩展程序”，选择 `dist`，再用公开的 Amazon 商品页测试图片 ZIP 和普通 HLS 视频。

## 三、建议的 GitHub 仓库设置

```text
仓库名：amazon-media-tool
中文名：Amazon 素材助手
可见性：Public
默认分支：main
许可证：MIT
```

建库时不要额外初始化 README、`.gitignore` 或 License，因为项目已经包含这些文件。

## 四、首次提交和推送

把 `<你的GitHub用户名>` 换成实际用户名：

```bash
git init -b main
git add .
git commit -m "Release v1.0.3"
git remote add origin https://github.com/<你的GitHub用户名>/amazon-media-tool.git
git push -u origin main
```

推送前运行：

```bash
git status
git ls-files
```

不应该提交 `node_modules/`、`dist/`、ZIP、CRX、`.DS_Store` 或本地日志。

## 五、创建标签和 Release

```bash
git tag -a v1.0.3 -m "Amazon 素材助手 v1.0.3"
git push origin v1.0.3
```

然后在 GitHub 仓库打开 Releases，点击“Draft a new release”：

1. 选择标签 `v1.0.3`；
2. 标题填写 `Amazon 素材助手 v1.0.3`；
3. 写明主要功能、权限和已知限制；
4. 上传 `amazon-media-tool-v1.0.3-unpacked.zip`；
5. 检查后点击“Publish release”。

建议的 Release 说明：

```text
Amazon 素材助手 v1.0.3

- 整套 Amazon 商品图识别、去重和高清 ZIP 下载
- 当前商品变体的 ASIN 与标题命名
- 普通 MPEG-TS HLS 商品视频捕获与 MP4 转换
- 不含广告、分析、后端接口或数据上传
- 不申请 <all_urls>、webRequest、Cookie 或浏览历史权限

已知限制：不支持 DRM、加密 HLS、fMP4、音视频分轨和字幕合并。
```

## 六、自动测试

推送到 `main` 或提交 Pull Request 后，GitHub Actions 会自动安装依赖、构建扩展并执行检查。确认 Actions 页面显示绿色通过后，再向用户推荐该版本。

## 七、发布后续版本

1. 同时修改 `package.json` 和 `manifest.json` 版本号；
2. 更新 README 和 Release 说明；
3. 运行构建和测试；
4. 在 Chrome 中真实验证；
5. 提交代码；
6. 创建新 Git 标签；
7. 创建新 Release 并上传新的可加载 ZIP。

Chrome 清单版本号只能包含数字和点，例如 `1.0.3`；Git 标签和 Release 可以使用 `v1.0.3`。
