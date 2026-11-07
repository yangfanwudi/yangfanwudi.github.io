// 运行配置。改这里即可切换本地/远程素材；不需要重新构建前端。
window.SGS_CONFIG = {
  // 本地服务器地址（由 server.mjs 提供）
  mediaBase: "app/media/",
  // 无名杀素材前缀：/media/noname/audio/... → apps/core/audio/...
  nonamePrefix: "noname/",
  // 皮肤素材前缀：/media/bwiki/<heroId>/...
  bwikiPrefix: "bwiki/",
  // 远程兜底模板；{commit} 会替换为 app/data/index.json 里的 commit
  remoteTemplate: "https://cdn.jsdelivr.net/gh/libnoname/noname@{commit}/apps/core/",
  // 本地没有素材时是否允许 302 到远程（server.mjs 读取）
  allowRemote: true,
};
