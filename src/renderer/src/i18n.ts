import type { UiLanguage } from '../../shared/types'

export interface UiCopy {
  brandName: string
  brandSecondary: string
  primaryNavigation: string
  reading: string
  listening: string
  notebook: string
  import: string
  languageControl: string
  aiServices: string
  aiStateLocal: string
  aiStateTextOnly: string
  aiStateSpeechOnly: string
  aiStateReady: string
  aiSettingsEyebrow: string
  aiSettingsTitle: string
  aiOnboardingTitle: string
  aiSettingsBody: string
  aiOnboardingBody: string
  localCapabilitiesTitle: string
  localCapabilities: string[]
  serviceCapabilitiesTitle: string
  serviceCapabilities: string[]
  aiConfigurationErrorTitle: string
  textAiTitle: string
  textAiBody: string
  textProviderLabel: string
  providerNone: string
  providerMimo: string
  providerOpenAiCompatible: string
  baseUrlLabel: string
  modelLabel: string
  apiKeyLabel: string
  savedCredentialPlaceholder: string
  environmentCredentialPlaceholder: string
  newCredentialPlaceholder: string
  customProviderWarning: string
  mimoProviderNote: string
  naturalAudioTitle: string
  naturalAudioBody: string
  enableNaturalAudio: string
  credentialModeLabel: string
  reuseMimoKey: string
  separateMimoKey: string
  sentenceAudioApiKeyLabel: string
  secureStorageTitle: string
  secureStorageNote: string
  secureStorageUnavailableTitle: string
  secureStorageUnavailable: string
  noConnectionTestNote: string
  saveAiSettings: string
  savingAiSettings: string
  closeAiSettings: string
  notNow: string
  disconnectAll: string
  disconnectWarning: string
  cancelDisconnect: string
  confirmDisconnect: string
  aiSettingsSaved: string
  aiServicesDisconnected: string
  linksDisabled: string
  contextCard: string
  selectWord: string
  selectWordHelp: string
  listeningSelectWordHelp: string
  listen: string
  preparingDefinition: string
  localPreviewBadge: string
  simpleDictionaryBadge: string
  mimoLiveBadge: string
  sentenceSpeed: string
  normalSentenceSpeed: string
  slowerSentenceSpeed: string
  naturalSentenceAudioUnavailable: string
  preparingSentenceAudio: string
  wordPronunciation: string
  preparingWordPronunciation: string
  listenToSentence: string
  noRecordedPronunciation: string
  refineWithContext: string
  refiningContext: string
  showChineseHint: string
  hideChineseHint: string
  preparingChineseHint: string
  localChineseReferenceLabel: string
  mimoChineseHintLabel: string
  audioAttribution: (artist: string, license: string) => string
  headwordAudioAttribution: (sourceWord: string, artist: string, license: string) => string
  usage: string
  savedToNotebook: string
  saveWord: string
  libraryEyebrow: string
  libraryTitle: string
  libraryBody: string
  articleCount: (count: number) => string
  articleListLabel: string
  openArticle: string
  deleteArticle: string
  deleteArticleTitle: string
  confirmDeleteArticle: (title: string) => string
  cancelDeleteArticle: string
  importedOn: (date: string) => string
  emptyLibraryTitle: string
  emptyLibraryBody: string
  importMarkdown: string
  fileSupport: string
  backToLibrary: string
  listeningLibraryEyebrow: string
  listeningLibraryTitle: string
  listeningLibraryBody: string
  audioCount: (count: number) => string
  audioListLabel: string
  openListening: string
  notTranscribed: string
  emptyListeningTitle: string
  emptyListeningBody: string
  audioFileSupport: string
  backToListening: string
  nowListening: string
  createTranscript: string
  transcribing: string
  showTranscript: string
  hideTranscript: string
  transcript: string
  sentenceCount: (count: number) => string
  sentenceCountUnit: (count: number) => string
  loadingAudio: string
  play: string
  pause: string
  backTenSeconds: string
  forwardTenSeconds: string
  audioProgress: string
  playbackSpeed: string
  transcriptionNote: string
  transcriptSelectionHelp: string
  playSentence: string
  listeningImported: (fileName: string) => string
  transcriptReady: (count: number) => string
  notebookEyebrow: string
  notebookTitle: string
  wordCount: (count: number) => string
  noSavedWords: string
  noSavedWordsHelp: string
  searchWords: string
  wordListLabel: string
  selectedWordDetails: string
  definitionLabel: string
  originalSentence: string
  noMatchingWords: string
  noMatchingWordsHelp: string
  savedOn: (date: string) => string
  remove: string
  dismiss: string
  imported: (fileName: string) => string
  articleDeleted: (title: string) => string
  savedLocally: (word: string) => string
  genericError: string
}

export const UI_COPY: Record<UiLanguage, UiCopy> = {
  en: {
    brandName: 'Origin English',
    brandSecondary: '原境英语',
    primaryNavigation: 'Primary navigation',
    reading: 'Reading',
    listening: 'Listening',
    notebook: 'Notebook',
    import: 'Import',
    languageControl: 'Interface language',
    aiServices: 'AI services',
    aiStateLocal: 'Local mode',
    aiStateTextOnly: 'Text AI ready',
    aiStateSpeechOnly: 'Natural voice ready',
    aiStateReady: 'All ready',
    aiSettingsEyebrow: 'Optional online capabilities',
    aiSettingsTitle: 'AI services',
    aiOnboardingTitle: 'Choose how much AI you want to use',
    aiSettingsBody:
      'Reading, dictionaries and local transcription do not depend on a model API. Connect only the online capabilities you want.',
    aiOnboardingBody:
      'Origin English works locally without an API. A text model and MiMo natural voice add the capabilities listed below.',
    localCapabilitiesTitle: 'Always available locally',
    localCapabilities: [
      'Article import, reading and word notebook',
      'Local English and Chinese dictionaries',
      'Dictionary word recordings',
      'Listening playback and local Small.EN transcript'
    ],
    serviceCapabilitiesTitle: 'Available after connection',
    serviceCapabilities: [
      'Contextual meaning when the local dictionary misses',
      'Optional contextual Chinese fallback',
      'Natural MiMo sentence audio'
    ],
    aiConfigurationErrorTitle: 'AI services are currently disabled',
    textAiTitle: 'Text AI',
    textAiBody:
      'Used only for contextual refinement and local-dictionary misses. The full article and audio are never sent.',
    textProviderLabel: 'Provider',
    providerNone: 'Off · local dictionaries only',
    providerMimo: 'MiMo preset',
    providerOpenAiCompatible: 'Custom OpenAI-compatible API',
    baseUrlLabel: 'Base URL',
    modelLabel: 'Model name',
    apiKeyLabel: 'API key',
    savedCredentialPlaceholder: 'Saved securely · leave blank to keep',
    environmentCredentialPlaceholder: 'Available from environment · leave blank to keep',
    newCredentialPlaceholder: 'Enter API key',
    customProviderWarning:
      'The key is sent only to the HTTPS Base URL you enter. Compatibility is checked on first use.',
    mimoProviderNote: 'Uses the official MiMo endpoint and the mimo-v2.5 text model.',
    naturalAudioTitle: 'Natural sentence audio',
    naturalAudioBody:
      'Uses the accepted MiMo Mia voice. Dictionary word recordings remain local and independent.',
    enableNaturalAudio: 'Enable MiMo natural sentence audio',
    credentialModeLabel: 'MiMo credential source',
    reuseMimoKey: 'Reuse the MiMo text key',
    separateMimoKey: 'Use a separate MiMo key',
    sentenceAudioApiKeyLabel: 'MiMo audio API key',
    secureStorageTitle: 'Protected on this Windows account',
    secureStorageNote:
      'Saved keys are encrypted by Electron safeStorage and are never returned by the settings API.',
    secureStorageUnavailableTitle: 'Secure storage is unavailable',
    secureStorageUnavailable:
      'New API keys cannot be saved on this device. Local capabilities remain available.',
    noConnectionTestNote:
      'Saving does not make an API request. The provider validates the key only when you first use that capability.',
    saveAiSettings: 'Save settings',
    savingAiSettings: 'Saving…',
    closeAiSettings: 'Close',
    notNow: 'Not now',
    disconnectAll: 'Disconnect all AI services',
    disconnectWarning:
      'This removes saved AI credentials from the app and returns to local mode. Local learning data is not affected.',
    cancelDisconnect: 'Keep connected',
    confirmDisconnect: 'Disconnect and remove keys',
    aiSettingsSaved: 'AI service settings saved',
    aiServicesDisconnected: 'AI services disconnected · local mode remains available',
    linksDisabled: 'Links are disabled in the reading view',
    contextCard: 'Context card',
    selectWord: 'Select a word',
    selectWordHelp:
      'Drag over one English word. Its sentence and explanation will stay beside the article.',
    listeningSelectWordHelp:
      'Select one English word in the transcript. Its sentence and explanation will stay beside the player.',
    listen: 'Listen',
    preparingDefinition: 'Preparing the meaning in context…',
    localPreviewBadge: 'No local entry · no text AI called',
    simpleDictionaryBadge: 'Simple English Wiktionary · local',
    mimoLiveBadge: 'Live contextual meaning · text AI',
    sentenceSpeed: 'Sentence speed',
    normalSentenceSpeed: 'Normal · 1.0×',
    slowerSentenceSpeed: 'Slower · 0.9×',
    naturalSentenceAudioUnavailable: 'Connect MiMo natural voice in AI services to read this sentence.',
    preparingSentenceAudio: 'Preparing natural audio…',
    wordPronunciation: 'Word audio',
    preparingWordPronunciation: 'Loading recording…',
    listenToSentence: 'Listen to sentence',
    noRecordedPronunciation: 'No dictionary recording is available for this word.',
    refineWithContext: 'Use the sentence to refine this meaning',
    refiningContext: 'Checking this sense with text AI…',
    showChineseHint: 'Show Chinese reference',
    hideChineseHint: 'Hide Chinese reference',
    preparingChineseHint: 'Preparing the Chinese reference…',
    localChineseReferenceLabel: 'Local Chinese reference · ECDICT',
    mimoChineseHintLabel: 'Contextual Chinese hint · text AI',
    audioAttribution: (artist, license) => `Recording: ${artist} · ${license}`,
    headwordAudioAttribution: (sourceWord, artist, license) =>
      `No recording for this form; playing the headword “${sourceWord}”. Recording: ${artist} · ${license}`,
    usage: 'Usage',
    savedToNotebook: 'Saved to notebook',
    saveWord: 'Save this word',
    libraryEyebrow: 'Your reading collection',
    libraryTitle: 'Articles',
    libraryBody: 'Choose an article and enter a calm space made only for reading.',
    articleCount: (count) => `${count} ${count === 1 ? 'article' : 'articles'}`,
    articleListLabel: 'Imported article list',
    openArticle: 'Open article',
    deleteArticle: 'Delete',
    deleteArticleTitle: 'Delete this article?',
    confirmDeleteArticle: (title) =>
      `“${title}” will be removed from your library and cannot be restored. Saved words and lookup history will stay in your notebook.`,
    cancelDeleteArticle: 'Keep article',
    importedOn: (date) => `Imported ${date}`,
    emptyLibraryTitle: 'Bring your first article here.',
    emptyLibraryBody: 'Import a UTF-8 Markdown file to begin your local reading collection.',
    importMarkdown: 'Import Markdown',
    fileSupport: 'Supports .md and .markdown files up to 5 MB.',
    backToLibrary: 'Back to articles',
    listeningLibraryEyebrow: 'Your listening collection',
    listeningLibraryTitle: 'Listening',
    listeningLibraryBody: 'Choose an audio file, listen at your pace and open its local transcript when you need it.',
    audioCount: (count) => `${count} ${count === 1 ? 'audio file' : 'audio files'}`,
    audioListLabel: 'Imported listening audio list',
    openListening: 'Open audio',
    notTranscribed: 'Transcript not created',
    emptyListeningTitle: 'Bring your first English audio here.',
    emptyListeningBody: 'Import an MP3 or WAV file. Your audio and transcript stay on this computer.',
    audioFileSupport: 'Supports MP3 and WAV files up to 100 MB.',
    backToListening: 'Back to listening files',
    nowListening: 'Now listening',
    createTranscript: 'Create transcript',
    transcribing: 'Transcribing locally…',
    showTranscript: 'Show transcript',
    hideTranscript: 'Hide transcript',
    transcript: 'Transcript',
    sentenceCount: (count) => `${count} ${count === 1 ? 'sentence' : 'sentences'}`,
    sentenceCountUnit: (count) => (count === 1 ? 'sentence' : 'sentences'),
    loadingAudio: 'Loading local audio…',
    play: 'Play',
    pause: 'Pause',
    backTenSeconds: 'Back 10 seconds',
    forwardTenSeconds: 'Forward 10 seconds',
    audioProgress: 'Audio progress',
    playbackSpeed: 'Playback speed',
    transcriptionNote:
      'The first transcript prepares the verified Small.EN model locally (about 488 MB). Nothing is uploaded. Sentence boundaries still need your listening check.',
    transcriptSelectionHelp: 'Select one English word to open its dictionary card on the right.',
    playSentence: 'Play sentence',
    listeningImported: (fileName) => `Imported ${fileName}`,
    transcriptReady: (count) => `Local transcript ready · ${count} sentences awaiting listening review`,
    notebookEyebrow: 'Saved locally',
    notebookTitle: 'Word notebook',
    wordCount: (count) => `${count} ${count === 1 ? 'word' : 'words'}`,
    noSavedWords: 'No saved words yet',
    noSavedWordsHelp: 'Select a word in an article and save it with its original sentence.',
    searchWords: 'Search words, meanings or sentences',
    wordListLabel: 'Saved word list',
    selectedWordDetails: 'Selected word details',
    definitionLabel: 'Meaning in context',
    originalSentence: 'Original sentence',
    noMatchingWords: 'No matching words',
    noMatchingWordsHelp: 'Try a different word or phrase.',
    savedOn: (date) => `Saved ${date}`,
    remove: 'Remove',
    dismiss: 'Dismiss',
    imported: (fileName) => `Imported ${fileName}`,
    articleDeleted: (title) => `Deleted “${title}”`,
    savedLocally: (word) => `${word} saved locally`,
    genericError: 'Something went wrong. Please try again.'
  },
  zh: {
    brandName: '原境英语',
    brandSecondary: 'Origin English',
    primaryNavigation: '主导航',
    reading: '阅读',
    listening: '听力',
    notebook: '生词本',
    import: '导入',
    languageControl: '界面语言',
    aiServices: 'AI 服务',
    aiStateLocal: '本地模式',
    aiStateTextOnly: '文本 AI 已连接',
    aiStateSpeechOnly: '自然朗读已连接',
    aiStateReady: '全部就绪',
    aiSettingsEyebrow: '可选联网能力',
    aiSettingsTitle: 'AI 服务',
    aiOnboardingTitle: '选择你需要的 AI 能力',
    aiSettingsBody: '阅读、词典和本地转写不依赖模型 API；只连接你真正需要的联网能力即可。',
    aiOnboardingBody:
      '不配置 API 也能使用原境英语。连接文本模型和 MiMo 自然朗读后，可以增加下面这些能力。',
    localCapabilitiesTitle: '无需 API，始终可用',
    localCapabilities: [
      '文章导入、阅读与生词本',
      '本地简明英英和英汉词典',
      '词典真人单词录音',
      '听力播放与本地 Small.EN 转写'
    ],
    serviceCapabilitiesTitle: '连接后增加',
    serviceCapabilities: [
      '本地词典未命中时的语境释义',
      '按需生成当前语境中文提示',
      'MiMo 自然原句朗读'
    ],
    aiConfigurationErrorTitle: 'AI 服务当前已停用',
    textAiTitle: '文本 AI',
    textAiBody: '只用于结合原句确认词义和本地词典未命中回退，不会发送整篇文章或音频。',
    textProviderLabel: '供应商',
    providerNone: '关闭 · 只用本地词典',
    providerMimo: 'MiMo 预设',
    providerOpenAiCompatible: '自定义 OpenAI 兼容接口',
    baseUrlLabel: 'Base URL',
    modelLabel: '模型名称',
    apiKeyLabel: 'API Key',
    savedCredentialPlaceholder: '已安全保存 · 留空保持不变',
    environmentCredentialPlaceholder: '已从环境变量读取 · 留空保持不变',
    newCredentialPlaceholder: '输入 API Key',
    customProviderWarning: 'Key 只会发送到你填写的 HTTPS 地址；接口兼容性会在首次使用时确认。',
    mimoProviderNote: '使用 MiMo 官方接口和 mimo-v2.5 文本模型。',
    naturalAudioTitle: '自然原句朗读',
    naturalAudioBody: '使用已试听接受的 MiMo Mia 音色；词典单词真人录音不受这里影响。',
    enableNaturalAudio: '启用 MiMo 自然原句朗读',
    credentialModeLabel: 'MiMo 凭证来源',
    reuseMimoKey: '复用 MiMo 文本 Key',
    separateMimoKey: '使用单独的 MiMo Key',
    sentenceAudioApiKeyLabel: 'MiMo 朗读 API Key',
    secureStorageTitle: '由当前 Windows 账户保护',
    secureStorageNote: '保存的 Key 会经 Electron safeStorage 加密，设置读取接口不会返回 Key。',
    secureStorageUnavailableTitle: '安全存储当前不可用',
    secureStorageUnavailable: '这台设备暂时不能保存新的 API Key，本地功能仍可继续使用。',
    noConnectionTestNote: '保存配置不会发起 API 请求；第一次使用对应能力时，供应商才会验证 Key。',
    saveAiSettings: '保存设置',
    savingAiSettings: '正在保存…',
    closeAiSettings: '关闭',
    notNow: '暂不配置',
    disconnectAll: '断开全部 AI 服务',
    disconnectWarning: '这会从应用中移除已保存的 AI 凭证并回到本地模式，不影响文章、生词和听力数据。',
    cancelDisconnect: '保持连接',
    confirmDisconnect: '断开并移除 Key',
    aiSettingsSaved: 'AI 服务设置已保存',
    aiServicesDisconnected: 'AI 服务已断开 · 本地功能继续可用',
    linksDisabled: '阅读界面中的链接已停用',
    contextCard: '语境卡片',
    selectWord: '选择一个单词',
    selectWordHelp: '拖动选中一个英语单词，它所在的句子和英英释义会固定在文章旁边。',
    listeningSelectWordHelp: '在逐句文本中选中一个英语单词，它所在的句子和英英释义会固定在播放器右侧。',
    listen: '朗读',
    preparingDefinition: '正在理解当前语境…',
    localPreviewBadge: '本地词典无结果 · 未调用文本 AI',
    simpleDictionaryBadge: '简明英英词典 · 本地查询',
    mimoLiveBadge: '文本 AI 实时语境释义',
    sentenceSpeed: '原句语速',
    normalSentenceSpeed: '正常 · 1.0×',
    slowerSentenceSpeed: '稍慢 · 0.9×',
    naturalSentenceAudioUnavailable: '请先在“AI 服务”中连接 MiMo 自然朗读。',
    preparingSentenceAudio: '正在准备自然朗读…',
    wordPronunciation: '单词发音',
    preparingWordPronunciation: '正在载入录音…',
    listenToSentence: '朗读原句',
    noRecordedPronunciation: '词典暂时没有这个单词的真人录音。',
    refineWithContext: '结合原句确认这个词义',
    refiningContext: '正在用文本 AI 判断当前词义…',
    showChineseHint: '显示中文参考',
    hideChineseHint: '隐藏中文参考',
    preparingChineseHint: '正在准备中文参考…',
    localChineseReferenceLabel: '本地中文参考 · ECDICT',
    mimoChineseHintLabel: '当前语境中文提示 · 文本 AI',
    audioAttribution: (artist, license) => `录音：${artist} · ${license}`,
    headwordAudioAttribution: (sourceWord, artist, license) =>
      `当前词形暂无真人录音，正在播放词典原型：${sourceWord}。录音：${artist} · ${license}`,
    usage: '用法',
    savedToNotebook: '已保存到生词本',
    saveWord: '保存这个单词',
    libraryEyebrow: '你的阅读收藏',
    libraryTitle: '文章',
    libraryBody: '选择一篇文章，进入只为阅读保留的安静空间。',
    articleCount: (count) => `${count} 篇文章`,
    articleListLabel: '已导入文章列表',
    openArticle: '打开文章',
    deleteArticle: '删除',
    deleteArticleTitle: '删除这篇文章？',
    confirmDeleteArticle: (title) =>
      `“${title}”将从文章库中删除且无法恢复。生词本中已保存的单词和查词记录会继续保留。`,
    cancelDeleteArticle: '保留文章',
    importedOn: (date) => `导入于 ${date}`,
    emptyLibraryTitle: '导入你的第一篇文章。',
    emptyLibraryBody: '导入 UTF-8 Markdown 文件，建立只保存在本机的阅读收藏。',
    importMarkdown: '导入 Markdown',
    fileSupport: '支持不超过 5 MB 的 .md 和 .markdown 文件。',
    backToLibrary: '返回文章列表',
    listeningLibraryEyebrow: '你的听力收藏',
    listeningLibraryTitle: '听力',
    listeningLibraryBody: '选择一个音频，按自己的节奏收听，需要时再展开本地转写。',
    audioCount: (count) => `${count} 个音频`,
    audioListLabel: '已导入听力音频列表',
    openListening: '打开音频',
    notTranscribed: '尚未转写',
    emptyListeningTitle: '导入你的第一个英语音频。',
    emptyListeningBody: '导入 MP3 或 WAV 文件，音频和转写都只保存在这台电脑上。',
    audioFileSupport: '支持不超过 100 MB 的 MP3 和 WAV 文件。',
    backToListening: '返回听力列表',
    nowListening: '正在收听',
    createTranscript: '生成逐句文本',
    transcribing: '正在本地转写…',
    showTranscript: '展开逐句文本',
    hideTranscript: '收起逐句文本',
    transcript: '逐句文本',
    sentenceCount: (count) => `${count} 句话`,
    sentenceCountUnit: () => '句话',
    loadingAudio: '正在载入本地音频…',
    play: '播放',
    pause: '暂停',
    backTenSeconds: '后退 10 秒',
    forwardTenSeconds: '前进 10 秒',
    audioProgress: '音频进度',
    playbackSpeed: '播放速度',
    transcriptionNote:
      '首次转写会在本机准备通过 WER 门禁的 Small.EN 模型（约 488 MB），不会上传音频。句界仍需你逐句试听验收。',
    transcriptSelectionHelp: '选中一个英语单词，右侧会打开它的词典卡片。',
    playSentence: '播放第',
    listeningImported: (fileName) => `已导入 ${fileName}`,
    transcriptReady: (count) => `本地转写已完成 · ${count} 句话等待逐句试听`,
    notebookEyebrow: '保存在本机',
    notebookTitle: '生词本',
    wordCount: (count) => `${count} 个单词`,
    noSavedWords: '还没有保存单词',
    noSavedWordsHelp: '在文章中选中一个单词，把它和原句一起保存下来。',
    searchWords: '搜索单词、释义或原句',
    wordListLabel: '已保存单词列表',
    selectedWordDetails: '当前单词详情',
    definitionLabel: '当前语境下的含义',
    originalSentence: '原句',
    noMatchingWords: '没有匹配的单词',
    noMatchingWordsHelp: '请尝试其他单词或短语。',
    savedOn: (date) => `保存于 ${date}`,
    remove: '移除',
    dismiss: '关闭',
    imported: (fileName) => `已导入 ${fileName}`,
    articleDeleted: (title) => `已删除“${title}”`,
    savedLocally: (word) => `已在本机保存 ${word}`,
    genericError: '出现了问题，请重试。'
  }
}
