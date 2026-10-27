# yangfanwudi.github.io

个人作品导航总站，GitHub Pages 用户主页仓库。

- 线上地址：https://yangfanwudi.github.io/
- 部署方式：`main` 分支根目录，纯静态 HTML，无构建步骤
- 页面：`index.html`（8 个作品卡片，中英切换）、`privacy.html`（隐私政策）
- SEO：根 `robots.txt` 指向 `sitemap.xml`；`sitemap.xml` 为 sitemap index，汇总 8 个子站 sitemap 与 `sitemap-home.xml`
- 子站：theboys-site、model-inspector-site、moku-site、yongye-site、github-daily-site、ziliao-mini-site、beidanci-site、mt-site

新增作品时：在 `index.html` 的 `.grid` 中加一张卡片，并把子站 sitemap 注册进 `sitemap.xml`。
