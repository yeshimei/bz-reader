/* ============================================================
 * bz-reader · 朗读（DeepSeek TTS）文案（src/i18n/tts.ts）
 *
 * 2026-11-13：这批文案单独成文件，再由八份语言包 spread 进去。
 *
 * 理由是节奏：功能还在改，文案一会儿加一条一会儿删一条；散进八份
 * 语言包每次都要改八处。按仓库规矩，日常开发只写实 zh / en，其余
 * 语言先放英文占位，上架那一版再统一翻译——这里把那条规矩落到结构上：
 * zh-TW 必须有繁体（测试会查简体字），ja/de/fr/es/pt 直接复用英文表。
 * ============================================================ */

export const TTS_ZH = {
  'settings.ttsEngine': '朗读方式',
  'settings.ttsEngine.deepseek': 'DeepSeek 语音',
  'settings.ttsEngine.system': '系统语音',
  'settings.ttsVoice': '音色',
  'settings.ttsVoice.stella': '海星 · 女声',
  'settings.ttsVoice.tide': '暗潮 · 男声',
  'settings.ttsMultiVoice': '旁白与对白分开念',
  'settings.ttsMultiVoice.hint': '引号里的对白换一把嗓子，听起来像两个人在讲；关掉就是整页一个声音。',
  'settings.ttsNarrator': '旁白音色',
  'settings.ttsDialogue': '对白音色',
  'settings.ttsDialogueOnly': '只念对白',
  'settings.ttsDialogueOnly.hint': '跳过旁白，只念引号里的对话，费用大约省三分之二。',
  'settings.ttsCache': '音频缓存',
  'settings.ttsCache.clear': '清空',
  'settings.ttsCache.hint': '听过的不再重复计费；0 = 不缓存。',
  'settings.ttsTest': '试听',
  'settings.ttsKey.hint': '用上面「AI 助手」里的接口地址与密钥；没填密钥时点朗读会带你去设置。',

  'notice.tts.noKey': '还没有配置 DeepSeek 密钥：去「设置 · AI 助手」填好再用朗读',
  'notice.tts.unsupportedLang': '这本书的语言 DeepSeek 语音不支持（仅中、粤、英、日、韩等），换系统语音试试',
  'notice.tts.failed': '语音合成失败',
  'notice.tts.rejected': '这段内容没通过语音服务审核，已跳过',
  'notice.tts.rate': '请求太频繁，稍后再试',
  'notice.tts.busy': '语音服务繁忙，稍后再试',
  'notice.tts.network': '连不上语音服务，检查网络后重试',
  'notice.tts.cost': '本页约 {chars} 字，约 {cost} 元',
  'notice.tts.cacheCleared': '朗读缓存已清空',
  'notice.tts.testing': '正在合成试听…',

  'tts.bar.narration': '旁白',
  'tts.bar.dialogue': '对白',
  'tts.bar.pause': '暂停',
  'tts.bar.resume': '继续',
  'tts.bar.stop': '停止',
  'tts.bar.prev': '上一段',
  'tts.bar.next': '下一段',
  'tts.bar.cost': '{cost} 元',
} as const;

export const TTS_ZH_TW = {
  'settings.ttsEngine': '朗讀方式',
  'settings.ttsEngine.deepseek': 'DeepSeek 語音',
  'settings.ttsEngine.system': '系統語音',
  'settings.ttsVoice': '音色',
  'settings.ttsVoice.stella': '海星 · 女聲',
  'settings.ttsVoice.tide': '暗潮 · 男聲',
  'settings.ttsMultiVoice': '旁白與對白分開念',
  'settings.ttsMultiVoice.hint': '引號裡的對白換一把嗓子，聽起來像兩個人在講；關掉就是整頁一個聲音。',
  'settings.ttsNarrator': '旁白音色',
  'settings.ttsDialogue': '對白音色',
  'settings.ttsDialogueOnly': '只念對白',
  'settings.ttsDialogueOnly.hint': '跳過旁白，只念引號裡的對話，費用大約省三分之二。',
  'settings.ttsCache': '音訊快取',
  'settings.ttsCache.clear': '清空',
  'settings.ttsCache.hint': '聽過的不再重複計費；0 = 不快取。',
  'settings.ttsTest': '試聽',
  'settings.ttsKey.hint': '用上面「AI 助手」裡的介面位址與金鑰；沒填金鑰時點朗讀會帶你去設定。',

  'notice.tts.noKey': '還沒有設定 DeepSeek 金鑰：去「設定 · AI 助手」填好再用朗讀',
  'notice.tts.unsupportedLang': '這本書的語言 DeepSeek 語音不支援（僅中、粵、英、日、韓等），換系統語音試試',
  'notice.tts.failed': '語音合成失敗',
  'notice.tts.rejected': '這段內容沒通過語音服務審核，已跳過',
  'notice.tts.rate': '請求太頻繁，稍後再試',
  'notice.tts.busy': '語音服務繁忙，稍後再試',
  'notice.tts.network': '連不上語音服務，檢查網路後重試',
  'notice.tts.cost': '本頁約 {chars} 字，約 {cost} 元',
  'notice.tts.cacheCleared': '朗讀快取已清空',
  'notice.tts.testing': '正在合成試聽…',

  'tts.bar.narration': '旁白',
  'tts.bar.dialogue': '對白',
  'tts.bar.pause': '暫停',
  'tts.bar.resume': '繼續',
  'tts.bar.stop': '停止',
  'tts.bar.prev': '上一段',
  'tts.bar.next': '下一段',
  'tts.bar.cost': '{cost} 元',
} as const;

const TTS_EN_BASE = {
  'settings.ttsEngine': 'Read-aloud engine',
  'settings.ttsEngine.deepseek': 'DeepSeek voice',
  'settings.ttsEngine.system': 'System voice',
  'settings.ttsVoice': 'Voice',
  'settings.ttsVoice.stella': 'Stella · female',
  'settings.ttsVoice.tide': 'Tide · male',
  'settings.ttsMultiVoice': 'Separate narrator and dialogue',
  'settings.ttsMultiVoice.hint': 'Quoted dialogue gets the other voice, so it sounds like two people. Off = one voice for the whole page.',
  'settings.ttsNarrator': 'Narrator voice',
  'settings.ttsDialogue': 'Dialogue voice',
  'settings.ttsDialogueOnly': 'Dialogue only',
  'settings.ttsDialogueOnly.hint': 'Skip narration and read only quoted speech; about two thirds cheaper.',
  'settings.ttsCache': 'Audio cache',
  'settings.ttsCache.clear': 'Clear',
  'settings.ttsCache.hint': 'Anything heard once is not billed again; 0 = no cache.',
  'settings.ttsTest': 'Preview',
  'settings.ttsKey.hint': 'Uses the endpoint and key from “AI assistant” above. Without a key, read aloud takes you to settings.',

  'notice.tts.noKey': 'No DeepSeek key yet: fill in “Settings · AI assistant” before using read aloud',
  'notice.tts.unsupportedLang': 'DeepSeek speech does not support this book’s language (zh, yue, en, ja, ko and a few more); try the system voice',
  'notice.tts.failed': 'Speech synthesis failed',
  'notice.tts.rejected': 'This passage was rejected by the speech service and was skipped',
  'notice.tts.rate': 'Too many requests, try again later',
  'notice.tts.busy': 'Speech service is busy, try again later',
  'notice.tts.network': 'Cannot reach the speech service; check the network and retry',
  'notice.tts.cost': 'About {chars} characters on this page, about {cost} yuan',
  'notice.tts.cacheCleared': 'Read-aloud cache cleared',
  'notice.tts.testing': 'Synthesizing a preview…',

  'tts.bar.narration': 'Narration',
  'tts.bar.dialogue': 'Dialogue',
  'tts.bar.pause': 'Pause',
  'tts.bar.resume': 'Resume',
  'tts.bar.stop': 'Stop',
  'tts.bar.prev': 'Previous',
  'tts.bar.next': 'Next',
  'tts.bar.cost': '{cost} yuan',
} as const;

/* 开发期占位：ja / de / fr / es / pt 先复用英文；上架那版统一翻译。 */
export const TTS_EN = TTS_EN_BASE;
export const TTS_JA = TTS_EN_BASE;
export const TTS_DE = TTS_EN_BASE;
export const TTS_FR = TTS_EN_BASE;
export const TTS_ES = TTS_EN_BASE;
export const TTS_PT = TTS_EN_BASE;
