/* ──────────────────────────────────────────────────────────────────────────
   Phase 7 P5 · i18n (zh-CN / en-US) — UI string dictionary + applier.

   Public API (window.MusicStudioI18n):
     · t(key)                — translate a dot-separated key, fall back to zh,
                                then to the key itself. Always returns a string.
     · apply(lang?)          — walk the DOM once and rewrite every
                                [data-i18n] / [data-i18n-attr]. Defaults to the
                                currently stored/active language.
     · cycle()               — flip zh ↔ en, persist, and re-apply.
     · readStored()          — 'zh' | 'en' (whitelist).
     · lang()                — current language (after cycle / apply).
     · setLang(lang)         — set + persist + re-apply (no-op if unchanged).
     · dict                  — the { zh: {…}, en: {…} } object (read-only).

   Wiring (HTML):
     <span data-i18n="nav.music">Music Generation</span>
     <input data-i18n-attr="placeholder:lyrics.searchPlaceholder" … />

   Notes:
     · Two-state only (zh ⇄ en), no auto. Stored in localStorage.minimax_lang.
     · <html lang> is kept in sync (affects browser spellcheck, AT).
     · Missing translations fall back to zh, then to the literal key — so
       the UI never shows a blank string mid-development.
     · Dictionary is small enough (~80 keys) to bundle in this file. We
       deliberately do not externalise to JSON — keeps deployment
       single-file and avoids a fetch race during init.
   ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'minimax_lang';
  var SUPPORTED = ['zh', 'en'];
  var DEFAULT_LANG = 'zh';

  /* Phase 26: external links (single source of truth). */
  var GMI_REFERRAL = 'https://console.gmicloud.ai/ref/5VHEBA7F';
  var GMI_CONSOLE = 'https://console.gmicloud.ai/';
  var GITHUB_REPO = 'https://github.com/snekkenull/minimax-music-studio';
  function extLink(url, text) {
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
  }

  /* ── dictionary ──────────────────────────────────────────────────────
     Namespaces: nav · common · studio · settings · batch · library · toast
     Keys are dot-separated. When adding a new key, ALWAYS add both
     languages — the parity check in test-phase7-p5.mjs will fail otherwise.
     ──────────────────────────────────────────────────────────────── */
  var DICT = {
    zh: {
      'common.language': '语言',
      'common.zh': '中文',
      'common.en': 'English',
      'common.theme': '主题',
      'common.themeDark': '深色',
      'common.themeLight': '浅色',
      'common.themeAuto': '自动',
      'common.studioSection': 'Studio',

      'nav.music': '音乐生成',
      'nav.history': '历史',
      'nav.sessions': '任务',
      'nav.newTask': '新建任务',
      'nav.noSessions': '暂无任务',
      'nav.session.more': '查看更多',
      'nav.session.loaded': '已从会话加载',
      'nav.session.playAria': '播放该 session 的 audio',
      'nav.session.noAudio': '该 session 没有 audio 缓存',
      'nav.session.played': '正在播放',
      'nav.task.ago.now': '刚刚',
      'nav.task.ago.min': '分钟前',
      'nav.task.ago.hour': '小时前',
      'nav.task.ago.day': '天前',
      'nav.task.more': '查看更多任务',
      'nav.task.unnamed': '任务',
      'nav.task.resume': '续跑',
      'nav.task.resumeTitle': '续跑该任务的未完成子项',
      'nav.task.active': '进行中',
      'nav.task.done': '已完成',
      'nav.task.cancelled': '已取消',
      'nav.task.delete': '删除任务',
      'nav.task.confirmDelete': '删除此任务及其历史?',
      'nav.task.subtitle': '曲目',
      'nav.task.subPlayAria': '播放此曲目',
      'nav.task.subNoAudio': '该曲目没有 audio 缓存',
      'nav.task.loaded': '已从任务加载',
      'nav.brand': 'Minimax',
      'nav.brandSub': 'Creative Studio',
      'nav.github': '项目仓库',

      'rail.fold': '折叠',
      'rail.restore': '展开',
      'rail.foldAria': '折叠侧栏',
      'rail.restoreAria': '展开侧栏',
      'rail.head.jobs': '任务',
      'rail.head.preview': '曲目',

      'studio.title': '音乐生成',
      'studio.crumbPrefix': 'MiniMax Week × ' + extLink(GMI_REFERRAL, 'GMI Cloud'),
      'studio.apiOnline': 'API 在线',
      'studio.apiKeyUnconfigured': 'API Key · 未配置',
      'studio.apiKeyConfigured': 'API Key · 已配置',
      'studio.lyricsLimit': '歌词 · 1–3500 字',
      'studio.card.lyricsTitle': '歌词与标题',
      'studio.card.llmAuto': 'LLM · 自动生成',
      'studio.card.lyricsPayload': '歌词',
      'studio.card.lyricsPayloadBadge': 'payload.lyrics',
      'studio.card.promptTitle': '音乐提示词',
      'studio.card.promptPayload': '风格与音频',
      'studio.card.stylePayload': 'payload',
      // Phase 8 (P7): 批量生产线
      'studio.production.cardTitle': '🚀 批量生产线',
      'studio.production.cardBadge': 'T3 · 自动派生 N 角度',
      'studio.production.cardHint': '写一个主题,选风格控制,启动后自动派生出 N 首独立作品',
      'studio.production.themeLabel': 'Theme / 主线',
      'studio.production.themeHint': '1–2 句话,生产线会从这个主题出发派生 N 个不同角度',
      'studio.production.themePlaceholder': '例如:雨夜的咖啡馆,两个陌生人在角落对坐',
      'studio.production.languagesLabel': '语言',
      'studio.production.targetLengthLabel': '目标长度',
      'studio.production.styleControl': '风格控制 · 3 轴 × 3 态',
      'studio.production.styleControlHint': '每轴选:锁定(用你选)/随机(从此轴随机)/禁用(避开此轴)',
      'studio.production.axisGenre': 'Genre · 风格',
      'studio.production.axisMood': 'Mood · 情绪',
      'studio.production.axisVocal': 'Vocal · 人声',
      'studio.production.modeLocked': '锁定',
      'studio.production.modeRandom': '随机',
      'studio.production.modeForbidden': '禁用',
      'studio.production.styleHelp': '锁定 = 用下面 pill 选;随机 = 复用下面 pill 池;禁用 = 不用此轴 — 下面 3 组 pill 是"可用素材",不直接选',
      'studio.production.summary': '数量走顶部 Batch 旋钮 · 启动后 LLM 自动派生 N 角度 + N 组 (lyrics, prompt)',
      'studio.production.startBtn': '开始生产',
      'studio.production.needTheme': '请先填写 Theme',
      'studio.field.theme': '主题/想法',
      'studio.field.themeHint': '歌曲讲什么 · 1–2 句',
      'studio.field.themePlaceholder': '例如:雨夜里的安静咖啡馆,两个陌生人同桌,无声的渴望',
      'studio.field.languages': '语言',
      'studio.field.languagesHint': '可多选',
      'studio.field.targetLength': '目标长度',
      'studio.field.targetLengthHint': '字符',
      'studio.field.mode': '模式',
      'studio.field.modeHint': '如何使用已锁定的标签',
      'studio.field.pillTags': '标签池',
      'studio.field.pillTagsHint': '点击锁定 · LLM 从同样的 36 个标签里选',
      'studio.field.musicPrompt': '音乐提示词',
      'studio.field.musicPromptHint': '0–2000 字符 · 流派、情绪、乐器、节奏',
      'studio.field.musicPromptPlaceholder': '独立民谣、忧郁、内省、渴望、独自行走、咖啡馆',
      'studio.field.sampleRate': '采样率',
      'studio.field.bitrate': '比特率',
      'studio.field.format': '格式',
      'studio.field.sampleRateHint': 'Hz',
      'studio.field.bitrateHint': 'bps',
      'studio.field.formatHint': '输出',
      'studio.btn.generatePackage': '生成',
      'studio.btn.generate': '生成',
      'studio.btn.loadSample': '载入示例',
      'studio.btn.clear': '清空',
      'studio.btn.apply': '应用',
      'studio.btn.applyToPackage': '应用 → 歌名 + 歌词 + 提示词',
      'studio.llm.fieldTitle': '歌曲名',
      'studio.llm.fieldTitleHint': '可编辑',
      'studio.llm.fieldTitlePlaceholder': 'e.g. 雨夜的咖啡馆',
      'studio.btn.retry': '重试',
      'studio.btn.stop': '停止剩余',
      'studio.btn.resume': '继续',
      'studio.btn.discard': '放弃',
      'studio.btn.working': '处理批次中…',
      'studio.btn.batch': '批量',
      'studio.btn.vary': '每首变化',
      'studio.btn.varyTitle': '开启后,每首用 LLM 生成独立的歌词+提示词;关闭则共享下面的文本框',
      'studio.batch.title': '单次批量提交的任务数 · 1–100',
      'studio.batch.placeholder': '1–100',
      'studio.resume.text': '检测到上次未完成的批次',
      'studio.llm.draftPackage': '草稿 · 一键应用到下方歌词和提示词文本框',
      'studio.llm.draftBadge': 'LLM 草稿 · 尚未应用',
      'studio.llm.outputPackage': '1 次 LLM 调用同时返回歌名+歌词+提示词,失败自动降级。',
      // Phase 10 (P10-3): 新增 12 个 pill 标签 i18n key (增量;旧 24 个保留)
      // zh/en 同名,因为 pill 显示就是英文原文 — 这些 key 仅供将来国际化切换
      'studio.llm.pillTag.East Asian modern': 'East Asian modern',
      'studio.llm.pillTag.East Asian ballad': 'East Asian ballad',
      'studio.llm.pillTag.Modern R&B': 'Modern R&B',
      'studio.llm.pillTag.Soul and gospel': 'Soul and gospel',
      'studio.llm.pillTag.bittersweet': 'bittersweet',
      'studio.llm.pillTag.anthemic': 'anthemic',
      'studio.llm.pillTag.ethereal': 'ethereal',
      'studio.llm.pillTag.noir': 'noir',
      'studio.llm.pillTag.airy soprano': 'airy soprano',
      'studio.llm.pillTag.gritty baritone': 'gritty baritone',
      'studio.llm.pillTag.falsetto': 'falsetto',
      'studio.llm.pillTag.operatic': 'operatic',
      'studio.preview.tracks': '曲目',
      'studio.preview.empty': '批量生成的曲目会出现在这里',
      'studio.preview.emptySub': '支持播放、下载、查看元数据',
      'studio.preview.duration': '时长',
      'studio.preview.sample': '采样率',
      'studio.preview.format': '格式',
      'studio.preview.download': '下载',
      'studio.preview.open': '打开',
      'studio.preview.copyUrl': '复制链接',
      'studio.preview.untitled': '未命名曲目',
      'studio.preview.payloadTitle': '请求负载',
      'studio.searchPlaceholder': '搜索标题、歌词、提示词…',
      'studio.placeholderLyrics': '[verse]\n路灯闪烁,夜风叹息\n影子拉长,我独自走\n旧外套裹着沉默的忧伤\n漂泊、渴望,何去何从\n\n[chorus]\n推开木门,香气四散\n熟悉的角落,陌生人凝望',

      'settings.title': '设置',
      'settings.subtitle': '配置 API 凭据、模型选择与请求端点。改动即时保存到',
      'settings.back': '返回 Studio',
      'settings.section.apiKey': 'API Key',
      'settings.section.apiKeyBadge': 'Authorization: Bearer',
      'settings.section.apiKeySub': '通过 ' + extLink(GMI_REFERRAL, 'GMI Cloud') + ' 申请 API key,用于调用音乐生成与 LLM 服务。密钥仅保存在浏览器本地。',
      'settings.section.musicModel': '音乐模型',
      'settings.section.musicModelSub': '生成音乐时使用的模型。',
      'settings.section.llmModel': 'LLM 模型',
      'settings.section.llmModelBadge': '歌词 / 提示词',
      'settings.section.llmModelSub': '辅助生成歌词与曲风提示的 LLM。',
      'settings.label.apiKey': 'API Key',
      'settings.label.musicModel': '模型',
      'settings.label.musicApiUrl': 'API URL',
      'settings.label.advanced': '高级',
      'settings.label.llmModel': '模型',
      'settings.label.llmApiUrl': 'LLM API URL',
      'settings.label.customModel': '自定义模型名',
      'settings.input.apiKeyPlaceholder': 'gmi_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'settings.input.reveal': '显示',
      'settings.input.customModelPlaceholder': 'your-org/your-model',
      'settings.input.hide': '隐藏',
      'settings.hint.apiKey': '发送到 ' + extLink(GMI_CONSOLE, '<code>console.gmicloud.ai</code>') + '。以 <code>mock_</code> 开头会路由到本地 mock 端点(自测模式)。',
      'settings.hint.musicApiUrl': '同源代理路径,一般无需修改。改为你自己的反向代理或直连上游 URL(需 CORS 允许)。',
      'settings.hint.llmApiUrl': 'OpenAI 兼容的 <code>/v1/chat/completions</code> 端点。改为自有网关可绕过 GMI 配额。',
      'settings.hint.llmModel': '不同模型风格差异较大。M2.7 中文歌词最自然。',
      'settings.hint.modelReset': '"重置" 恢复 <code>minimax-music-3.0</code>。',
      'settings.hint.customModel': '留空使用上方下拉框选择的模型;支持任意兼容 <code>chat-completions</code> 的模型 ID。',
      'settings.model.custom': '自定义…',
      'settings.status.unconfigured': '未配置',
      'settings.status.configured': '已配置',
      'settings.status.idle': '未测试',
      'settings.status.checking': '检查中…',
      'settings.status.unreachable': '不可达',
      'settings.status.unreachableKey': '不可达 · 未带 key',
      'settings.status.unreachableNet': '不可达 · 网络错误',
      'settings.btn.testAll': '测试全部设置',
      'settings.btn.reset': '恢复默认',
      'settings.btn.save': '保存修改',
      'settings.toast.saved': '设置已保存',
      'settings.toast.reset': '已重置为默认值',
      'settings.toast.missingKey': '未配置 API key',
      'settings.confirmReset': '确定要重置所有设置为默认值吗?\n(API Key 也会被清空,需重新输入)',
      'settings.probe.test': '测试',
      'settings.probe.checking': '检测中…',
      'settings.probe.testing': 'Testing…',
      'settings.probe.invalid': 'URL 格式不合法',
      'settings.probe.reachable': '可达',
      'settings.probe.unreachable': '不可达',
      'settings.probe.noKey': '未带 key',
      'settings.probe.authFail': '鉴权失败',
      'settings.probe.crossOrigin': '跨域可达',
      'settings.probe.empty': '未填写',
      'settings.modelDefault': '默认',
      'settings.modelFast': '快速',
      'settings.modelLegacy': '旧版',
      'settings.import.invalidLink': '无效的导入链接',
      'settings.import.success': '已导入设置',
      'settings.import.errorParse': '解析失败:链接格式不正确',
      'settings.import.confirmTitle': '导入以下设置吗?',
      'settings.import.fieldApiKey': 'API Key',
      'settings.import.fieldMusicModel': '音乐模型',
      'settings.import.fieldMusicApiUrl': '音乐 API URL',
      'settings.import.fieldLlmModel': 'LLM 模型',
      'settings.import.fieldLlmApiUrl': 'LLM API URL',
      'settings.import.confirmBtn': '导入',

      'toast.apiKeyMissing': '未配置 API key',
      'toast.saved': '设置已保存',
      'toast.reset': '已重置为默认值',
      'toast.copied': '已复制',
      'toast.exportedJSON': '已导出 JSON',
      'toast.exportedCSV': '已导出 CSV',
      'toast.exportedZip': '已导出 ZIP',

      'dlToast.title.download': '下载 {name}',
      'dlToast.title.exportJSON': '导出 {n} 首为 JSON',
      'dlToast.title.exportCSV': '导出 {n} 首为 CSV',
      'dlToast.title.exportZip': '打包 {n} 首为 ZIP',
      'dlToast.done.downloaded': '已下载 {name}',
      'dlToast.done.downloadedPlusLyrics': '已下载 {name} + lyrics',
      'dlToast.done.exportedJSON': '已导出 {n} 首为 JSON',
      'dlToast.done.exportedCSV': '已导出 {n} 首为 CSV',
      'dlToast.done.exportedZip': '已下载 {n} 首 ZIP',
      'dlToast.error.download': '下载失败: {msg}',
      'dlToast.error.export': '导出失败: {msg}',
      'dlToast.error.zip': '打包失败: {msg}',
      'dlToast.error.nothing': 'Nothing to download',
      'dlToast.error.noAudio': 'No audio to download',

      'library.title': '历史',
      'library.tab.all': '全部',
      'library.tab.favorites': '★ 收藏',
      'library.tab.trash': '🗑 回收站',
      'library.searchPlaceholder': '搜索标题、歌词、提示词…',
      'library.empty.title': '还没有保存的曲目。',
      'library.empty.subtitle': '生成的曲目会自动出现在这里。',
      'library.btn.select': '☐ 选择',
      'library.btn.exportJSON': '↓ JSON',
      'library.btn.exportCSV': '↓ CSV',
      'library.btn.clearAll': '清空全部',
      'library.select.count': '已选',
      'library.select.all': '全选',
      'library.select.none': '全不选',
      'library.select.zip': '↓ ZIP',
      'library.select.fav': '★ 收藏',
      'library.select.del': '🗑',
      'library.select.cancel': '✕',
      'library.action.favTitle': '收藏',
      'library.action.delTitle': '移到回收站',
      'library.action.downloadTitle': '下载',
      'library.action.retryTitle': '重试',

      'attr.placeholder.themePlaceholder': '例如:雨夜里的安静咖啡馆,两个陌生人同桌,无声的渴望',
      'attr.placeholder.musicPromptPlaceholder': '独立民谣、忧郁、内省、渴望、独自行走、咖啡馆',
      'attr.placeholder.searchTracks': '搜索标题、歌词、提示词…',
      'attr.placeholder.apiKey': 'gmi_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'attr.aria.themeDark': '主题: 深色',
      'attr.aria.themeLight': '主题: 浅色',
      'attr.aria.themeAuto': '主题: 自动',
      'attr.aria.batchInput': '批量任务数(1–100)',
      'attr.aria.langToggle': '切换语言',
      'attr.aria.revealKey': '显示/隐藏密钥',
      'attr.aria.openSettings': '打开 Settings 配置 API Key',
      'attr.aria.githubRepo': '在 GitHub 上打开项目仓库(新窗口)',
    },
    en: {
      'common.language': 'Language',
      'common.zh': '中文',
      'common.en': 'English',
      'common.theme': 'Theme',
      'common.themeDark': 'Dark',
      'common.themeLight': 'Light',
      'common.themeAuto': 'Auto',
      'common.studioSection': 'Studio',

      'nav.music': 'Music Generation',
      'nav.history': 'History',
      'nav.sessions': 'Tasks',
      'nav.newTask': 'New task',
      'nav.noSessions': 'No tasks yet',
      'nav.session.more': 'Show more',
      'nav.session.loaded': 'Loaded from session',
      'nav.session.playAria': 'Play this session audio',
      'nav.session.noAudio': 'No audio cached for this session',
      'nav.session.played': 'Now playing',
      'nav.task.ago.now': 'now',
      'nav.task.ago.min': 'm',
      'nav.task.ago.hour': 'h',
      'nav.task.ago.day': 'd',
      'nav.task.more': 'Show more',
      'nav.task.unnamed': 'Task',
      'nav.task.resume': 'Resume',
      'nav.task.resumeTitle': 'Resume remaining sub-tasks',
      'nav.task.active': 'Active',
      'nav.task.done': 'Done',
      'nav.task.cancelled': 'Cancelled',
      'nav.task.delete': 'Delete task',
      'nav.task.confirmDelete': 'Delete this task and its history?',
      'nav.task.subtitle': 'Track',
      'nav.task.subPlayAria': 'Play this track',
      'nav.task.subNoAudio': 'No audio cached for this track',
      'nav.task.loaded': 'Loaded from task',
      'nav.brand': 'Minimax',
      'nav.brandSub': 'Creative Studio',
      'nav.github': 'Source',

      'rail.fold': 'Collapse',
      'rail.restore': 'Expand',
      'rail.foldAria': 'Collapse side column',
      'rail.restoreAria': 'Expand side column',
      'rail.head.jobs': 'Tasks',
      'rail.head.preview': 'Tracks',

      'studio.title': 'Music Generation',
      'studio.crumbPrefix': 'MiniMax Week × ' + extLink(GMI_REFERRAL, 'GMI Cloud'),
      'studio.apiOnline': 'API Online',
      'studio.apiKeyUnconfigured': 'API Key · Not set',
      'studio.apiKeyConfigured': 'API Key · Configured',
      'studio.lyricsLimit': 'Lyrics · 1–3500 chars',
      'studio.card.lyricsTitle': 'Lyrics & Title',
      'studio.card.llmAuto': 'LLM · auto-generate',
      'studio.card.lyricsPayload': 'Lyrics',
      'studio.card.lyricsPayloadBadge': 'payload.lyrics',
      'studio.card.promptTitle': 'Music Prompt',
      'studio.card.promptPayload': 'Style & Audio',
      'studio.card.stylePayload': 'payload',
      // Phase 8 (P7): Production line
      'studio.production.cardTitle': '🚀 Batch production line',
      'studio.production.cardBadge': 'T3 · derive N angles',
      'studio.production.cardHint': 'write a theme, pick style control, start → LLM auto-derives N distinct songs',
      'studio.production.themeLabel': 'Theme / main idea',
      'studio.production.themeHint': '1–2 sentences, the line will derive N different angles from this',
      'studio.production.themePlaceholder': 'e.g. a quiet café in the rain, two strangers sharing a corner table',
      'studio.production.languagesLabel': 'Languages',
      'studio.production.targetLengthLabel': 'Target length',
      'studio.production.styleControl': 'Style control · 3 axes × 3 modes',
      'studio.production.styleControlHint': 'per axis: locked (use yours) / random (from this axis) / forbidden (avoid this axis)',
      'studio.production.axisGenre': 'Genre',
      'studio.production.axisMood': 'Mood',
      'studio.production.axisVocal': 'Vocal',
      'studio.production.modeLocked': 'Locked',
      'studio.production.modeRandom': 'Random',
      'studio.production.modeForbidden': 'Forbidden',
      'studio.production.styleHelp': 'Locked = use pills below; Random = pull from the same pool; Forbidden = skip this axis — the 3 pill groups below are "available material", not directly applied',
      'studio.production.summary': 'count comes from the top Batch knob · on start, LLM derives N angles + N (lyrics, prompt) pairs',
      'studio.production.startBtn': 'Start production',
      'studio.production.needTheme': 'Please fill in a theme first',
      'studio.field.theme': 'Theme / idea',
      'studio.field.themeHint': 'what the song is about · 1–2 sentences',
      'studio.field.themePlaceholder': 'e.g. a quiet café in the rain, two strangers sharing a table, unspoken longing',
      'studio.field.languages': 'Languages',
      'studio.field.languagesHint': 'multi-select',
      'studio.field.targetLength': 'Target length',
      'studio.field.targetLengthHint': 'chars',
      'studio.field.mode': 'Mode',
      'studio.field.modeHint': 'how to use your locked tags',
      'studio.field.pillTags': 'Pill tags',
      'studio.field.pillTagsHint': 'click to lock · LLM picks from the same 36 tags',
      'studio.field.musicPrompt': 'Music prompt',
      'studio.field.musicPromptHint': '0–2000 chars · genre, mood, instruments, tempo',
      'studio.field.musicPromptPlaceholder': 'Indie folk, melancholic, introspective, longing, solitary walk, coffee shop',
      'studio.field.sampleRate': 'Sample rate',
      'studio.field.bitrate': 'Bitrate',
      'studio.field.format': 'Format',
      'studio.field.sampleRateHint': 'Hz',
      'studio.field.bitrateHint': 'bps',
      'studio.field.formatHint': 'output',
      'studio.btn.generatePackage': 'Generate',
      'studio.btn.generate': 'Generate',
      'studio.btn.loadSample': 'Load sample',
      'studio.btn.clear': 'Clear',
      'studio.btn.apply': 'Apply',
      'studio.btn.applyToPackage': 'Apply → Title + Lyrics + Prompt',
      'studio.llm.fieldTitle': 'Title',
      'studio.llm.fieldTitleHint': 'Editable song title',
      'studio.llm.fieldTitlePlaceholder': 'e.g. Quiet Café Rain',
      'studio.btn.retry': 'Retry',
      'studio.btn.stop': 'Stop remaining',
      'studio.btn.resume': 'Resume',
      'studio.btn.discard': 'Discard',
      'studio.btn.working': 'Working on batch…',
      'studio.btn.batch': 'Batch',
      'studio.btn.vary': 'Vary each',
      'studio.btn.varyTitle': 'When on, each track gets its own LLM-generated lyrics + prompt; off shares the textareas below',
      'studio.batch.title': 'Tracks per batch · 1–100',
      'studio.batch.placeholder': '1–100',
      'studio.resume.text': 'Unfinished batch from previous session',
      'studio.llm.draftPackage': 'Draft · click Apply to send to both Lyrics and Music prompt textareas',
      'studio.llm.draftBadge': 'LLM draft · not yet applied',
      'studio.llm.outputPackage': '1 LLM call returns title + lyrics + prompt together; auto-falls-back if malformed.',
      // Phase 10 (P10-3): 12 new pill tag i18n keys (additive; old 24 retained)
      'studio.llm.pillTag.East Asian modern': 'East Asian modern',
      'studio.llm.pillTag.East Asian ballad': 'East Asian ballad',
      'studio.llm.pillTag.Modern R&B': 'Modern R&B',
      'studio.llm.pillTag.Soul and gospel': 'Soul and gospel',
      'studio.llm.pillTag.bittersweet': 'bittersweet',
      'studio.llm.pillTag.anthemic': 'anthemic',
      'studio.llm.pillTag.ethereal': 'ethereal',
      'studio.llm.pillTag.noir': 'noir',
      'studio.llm.pillTag.airy soprano': 'airy soprano',
      'studio.llm.pillTag.gritty baritone': 'gritty baritone',
      'studio.llm.pillTag.falsetto': 'falsetto',
      'studio.llm.pillTag.operatic': 'operatic',
      'studio.preview.tracks': 'Tracks',
      'studio.preview.empty': 'Generated tracks will appear here',
      'studio.preview.emptySub': 'playback, download, and metadata view supported',
      'studio.preview.duration': 'Duration',
      'studio.preview.sample': 'Sample',
      'studio.preview.format': 'Format',
      'studio.preview.download': 'Download',
      'studio.preview.open': 'Open',
      'studio.preview.copyUrl': 'Copy URL',
      'studio.preview.untitled': 'Untitled track',
      'studio.preview.payloadTitle': 'Request payload',
      'studio.searchPlaceholder': 'Search title, lyrics, prompt…',
      'studio.placeholderLyrics': '[verse]\nStreetlights flicker, the night breeze sighs\nShadows stretch as I walk alone\nAn old coat wraps my silent sorrow\nWandering, longing, where should I go\n\n[chorus]\nPushing the wooden door, the aroma spreads\nIn a familiar corner, a stranger gazes',

      'settings.title': 'Settings',
      'settings.subtitle': 'Configure API credentials, model choice, and endpoints. Changes save to',
      'settings.back': '← Back to Studio',
      'settings.section.apiKey': 'API Key',
      'settings.section.apiKeyBadge': 'Authorization: Bearer',
      'settings.section.apiKeySub': 'Request an API key from ' + extLink(GMI_REFERRAL, 'GMI Cloud') + ' to call music generation and LLM services. The key is stored only in your browser.',
      'settings.section.musicModel': 'Music model',
      'settings.section.musicModelSub': 'Model used to generate music. Default',
      'settings.section.llmModel': 'LLM model',
      'settings.section.llmModelBadge': 'lyrics / prompt',
      'settings.section.llmModelSub': 'LLM that helps generate lyrics and style prompts.',
      'settings.label.apiKey': 'API Key',
      'settings.label.musicModel': 'Model',
      'settings.label.musicApiUrl': 'API URL',
      'settings.label.advanced': 'advanced',
      'settings.label.llmModel': 'Model',
      'settings.label.llmApiUrl': 'LLM API URL',
      'settings.label.customModel': 'Custom model name',
      'settings.input.apiKeyPlaceholder': 'gmi_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'settings.input.reveal': 'Show',
      'settings.input.customModelPlaceholder': 'your-org/your-model',
      'settings.input.hide': 'Hide',
      'settings.hint.apiKey': 'Sent to ' + extLink(GMI_CONSOLE, '<code>console.gmicloud.ai</code>') + '. Keys starting with <code>mock_</code> route to a local mock endpoint (self-test mode).',
      'settings.hint.musicApiUrl': 'Same-origin proxy path — no need to change. Point it at your own reverse proxy or direct upstream URL (CORS required).',
      'settings.hint.llmApiUrl': 'OpenAI-compatible <code>/v1/chat/completions</code> endpoint. Replace with your own gateway to bypass GMI quotas.',
      'settings.hint.llmModel': 'Different models have quite different styles. M2.7 produces the most natural Chinese lyrics.',
      'settings.hint.modelReset': '"Reset" restores <code>minimax-music-3.0</code>.',
      'settings.hint.customModel': 'Leave blank to use the dropdown above. Any OpenAI-compatible <code>chat-completions</code> model ID is supported.',
      'settings.model.custom': 'Custom…',
      'settings.status.unconfigured': 'Not set',
      'settings.status.configured': 'Configured',
      'settings.status.idle': 'Not tested',
      'settings.status.checking': 'Checking…',
      'settings.status.unreachable': 'Unreachable',
      'settings.status.unreachableKey': 'Unreachable · no key sent',
      'settings.status.unreachableNet': 'Unreachable · network error',
      'settings.btn.testAll': 'Test all settings',
      'settings.btn.reset': 'Reset all',
      'settings.btn.save': 'Save changes',
      'settings.toast.saved': 'Settings saved',
      'settings.toast.reset': 'Reset to defaults',
      'settings.toast.missingKey': 'API key not configured',
      'settings.confirmReset': 'Reset all settings to defaults?\n(API Key will also be cleared)',
      'settings.probe.test': 'Test',
      'settings.probe.checking': 'Checking…',
      'settings.probe.testing': 'Testing…',
      'settings.probe.invalid': 'Invalid URL format',
      'settings.probe.reachable': 'Reachable',
      'settings.probe.unreachable': 'Unreachable',
      'settings.probe.noKey': 'no key sent',
      'settings.probe.authFail': 'Auth failed',
      'settings.probe.crossOrigin': 'Cross-origin reachable',
      'settings.probe.empty': 'empty',
      'settings.modelDefault': 'default',
      'settings.modelFast': 'fast',
      'settings.modelLegacy': 'legacy',
      'settings.import.invalidLink': 'Invalid import link',
      'settings.import.success': 'Settings imported',
      'settings.import.errorParse': 'Parse failed: link is malformed',
      'settings.import.confirmTitle': 'Import these settings?',
      'settings.import.fieldApiKey': 'API Key',
      'settings.import.fieldMusicModel': 'Music model',
      'settings.import.fieldMusicApiUrl': 'Music API URL',
      'settings.import.fieldLlmModel': 'LLM model',
      'settings.import.fieldLlmApiUrl': 'LLM API URL',
      'settings.import.confirmBtn': 'Import',

      'toast.apiKeyMissing': 'API key not configured',
      'toast.saved': 'Settings saved',
      'toast.reset': 'Reset to defaults',
      'toast.copied': 'Copied',
      'toast.exportedJSON': 'Exported JSON',
      'toast.exportedCSV': 'Exported CSV',
      'toast.exportedZip': 'Exported ZIP',

      'dlToast.title.download': 'Download {name}',
      'dlToast.title.exportJSON': 'Export {n} as JSON',
      'dlToast.title.exportCSV': 'Export {n} as CSV',
      'dlToast.title.exportZip': 'Bundle {n} as ZIP',
      'dlToast.done.downloaded': 'Downloaded {name}',
      'dlToast.done.downloadedPlusLyrics': 'Downloaded {name} + lyrics',
      'dlToast.done.exportedJSON': 'Exported {n} as JSON',
      'dlToast.done.exportedCSV': 'Exported {n} as CSV',
      'dlToast.done.exportedZip': 'Downloaded {n} as ZIP',
      'dlToast.error.download': 'Download failed: {msg}',
      'dlToast.error.export': 'Export failed: {msg}',
      'dlToast.error.zip': 'Bundle failed: {msg}',
      'dlToast.error.nothing': 'Nothing to download',
      'dlToast.error.noAudio': 'No audio to download',

      'library.title': 'History',
      'library.tab.all': 'All',
      'library.tab.favorites': '★ Favorites',
      'library.tab.trash': '🗑 Trash',
      'library.searchPlaceholder': 'Search title, lyrics, prompt…',
      'library.empty.title': 'No saved tracks yet.',
      'library.empty.subtitle': 'Generated tracks will appear here automatically.',
      'library.btn.select': '☐ Select',
      'library.btn.exportJSON': '↓ JSON',
      'library.btn.exportCSV': '↓ CSV',
      'library.btn.clearAll': 'Clear all',
      'library.select.count': 'selected',
      'library.select.all': 'All',
      'library.select.none': 'None',
      'library.select.zip': '↓ ZIP',
      'library.select.fav': '★ Fav',
      'library.select.del': '🗑',
      'library.select.cancel': '✕',
      'library.action.favTitle': 'Favorite',
      'library.action.delTitle': 'Move to trash',
      'library.action.downloadTitle': 'Download',
      'library.action.retryTitle': 'Retry',

      'attr.placeholder.themePlaceholder': 'e.g. a quiet café in the rain, two strangers sharing a table, unspoken longing',
      'attr.placeholder.musicPromptPlaceholder': 'Indie folk, melancholic, introspective, longing, solitary walk, coffee shop',
      'attr.placeholder.searchTracks': 'Search title, lyrics, prompt…',
      'attr.placeholder.apiKey': 'gmi_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'attr.aria.themeDark': 'Theme: dark',
      'attr.aria.themeLight': 'Theme: light',
      'attr.aria.themeAuto': 'Theme: auto',
      'attr.aria.batchInput': 'Batch size (1–100)',
      'attr.aria.langToggle': 'Toggle language',
      'attr.aria.revealKey': 'Show/hide key',
      'attr.aria.openSettings': 'Open Settings to configure API Key',
      'attr.aria.githubRepo': 'Open project repository on GitHub (new window)',
    },
  };

  /* ── runtime state ────────────────────────────────────────────────── */
  var currentLang = null;

  function readStored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === 'zh' || v === 'en') return v;
    } catch (e) { /* localStorage blocked */ }
    // No explicit user choice yet — fall back to browser language.
    return detectBrowserLang() || DEFAULT_LANG;
  }

  /* Phase 26 / Phase 29: detect browser language for first-visit language.
     navigator.languages[] is a preference-ordered list — [0] is the
     primary user language. We read ONLY the primary tag, on purpose:
     chasing fallbacks mis-identifies users whose secondary tags are
     inherited injections (e.g. 'zh-Hans-US' shipped by some Chrome
     extensions / installers) and don't reflect the current OS locale.

     Treats any tag starting with 'zh' (zh, zh-CN, zh-HK, …) as Chinese;
     everything else is English. Falls back to DEFAULT_LANG when neither
     navigator.language nor navigator.languages are exposed. */
  function detectBrowserLang() {
    try {
      var tags = (navigator.languages && navigator.languages.length)
        ? navigator.languages
        : (navigator.language ? [navigator.language] : []);
      if (!tags.length) return DEFAULT_LANG;
      var primary = String(tags[0] || '').toLowerCase();
      if (primary.indexOf('zh') === 0) return 'zh';
      return 'en';
    } catch (e) { /* navigator unavailable */ }
    return DEFAULT_LANG;
  }

  function writeStored(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  function lang() {
    return currentLang || readStored();
  }

  function t(key) {
    var L = lang();
    if (DICT[L] && Object.prototype.hasOwnProperty.call(DICT[L], key)) {
      return DICT[L][key];
    }
    if (DICT.zh && Object.prototype.hasOwnProperty.call(DICT.zh, key)) {
      return DICT.zh[key];
    }
    return key;
  }

  function apply(targetLang) {
    var L = (targetLang === 'en' || targetLang === 'zh') ? targetLang : lang();
    currentLang = L;
    writeStored(L);

    // Sync <html lang> (affects browser spellcheck, AT, and CSS :lang()).
    try { document.documentElement.setAttribute('lang', L === 'zh' ? 'zh-CN' : 'en'); } catch (e) {}

    // text content
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      if (!k) continue;
      // Preserve any inline HTML the key contains (we deliberately use
      // <code> in some hint strings). textContent would strip it.
      // We support a small allowlist of HTML tags (code, em, strong, br).
      var v = t(k);
      nodes[i].innerHTML = sanitiseInline(v);
    }

    // attribute-based translations: e.g. "placeholder:foo.bar" → setAttribute
    var attrNodes = document.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrNodes.length; j++) {
      var spec = attrNodes[j].getAttribute('data-i18n-attr');
      if (!spec) continue;
      var parts = spec.split(':');
      if (parts.length < 2) continue;
      var attr = parts[0];
      var akey = parts.slice(1).join(':');
      attrNodes[j].setAttribute(attr, t(akey));
    }

    // Notify other modules so they can re-render dynamic text (toasts,
    // status chips, batch labels, etc) without re-running our DOM walk.
    try {
      document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: L } }));
    } catch (e) { /* old browsers */ }
  }

  /* Conservative HTML allowlist — only the inline tags we actually emit
     in the dictionary (for <code>, <em>, <strong> in hints). */
  function sanitiseInline(html) {
    if (html == null) return '';
    // Strip <script>, <style>, on* attrs, javascript: URLs — anything
    // beyond the allowlist. Keeps the door closed for XSS via i18n
    // string override.
    var s = String(html);
    s = s.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '');
    s = s.replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '');
    s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
    return s;
  }

  function setLang(L) {
    if (L !== 'zh' && L !== 'en') L = 'zh';
    apply(L);
  }

  function cycle() {
    var next = lang() === 'zh' ? 'en' : 'zh';
    setLang(next);
    return next;
  }

  /* Auto-init: apply stored language as soon as the body has the
     elements wired. We listen to DOMContentLoaded so we run AFTER
     theme.js (which fires in <head>) but BEFORE app.js, so app.js
     can call t() during its own DOMContentLoaded handler. We queue
     via `defer`-equivalent ordering: i18n.js <script> is loaded
     *after* theme.js but *before* app.js, so by the time the
     modules read window.MusicStudioI18n it is fully populated.

     For elements that exist at DOMContentLoaded, we walk them. For
     dynamic content (toasts, status text) we expose t() so callers
     can translate on demand. */
  function boot() {
    apply(readStored());
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    // DOM already parsed (i18n.js loaded after content) — apply now.
    boot();
  }

  /* expose */
  root.MusicStudioI18n = {
    t: t,
    apply: apply,
    cycle: cycle,
    setLang: setLang,
    readStored: readStored,
    detectBrowserLang: detectBrowserLang,
    lang: lang,
    dict: DICT,
    supported: SUPPORTED,
  };
})(typeof window !== 'undefined' ? window : globalThis);
