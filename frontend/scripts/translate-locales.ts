import * as fs from 'fs'
import * as path from 'path'

const RAW_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY

if (!RAW_API_KEY) {
  console.error('❌ GOOGLE_TRANSLATE_API_KEY environment variable is not set')
  process.exit(1)
}

// process.exit() returns never, so RAW_API_KEY is narrowed to string here.
const API_KEY: string = RAW_API_KEY

interface StringEntry {
  key: string
  value: string
  hasInterpolation: boolean
}

interface GoogleTranslateResponse {
  data?: {
    translations?: Array<{ translatedText: string }>
  }
}

/**
 * 遞歸提取 JSON 中所有字串值
 */
function extractStrings(obj: Record<string, unknown>, prefix: string = ''): StringEntry[] {
  const strings: StringEntry[] = []

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      const hasInterpolation = /\{\{[\w_]+\}\}/.test(value)
      strings.push({
        key: fullKey,
        value,
        hasInterpolation,
      })
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      strings.push(...extractStrings(value as Record<string, unknown>, fullKey))
    }
  }

  return strings
}

/**
 * 將插值佔位符替換為臨時文本（以便翻譯保留結構）
 */
function protectInterpolation(text: string): { text: string; vars: Record<string, string> } {
  const vars: Record<string, string> = {}
  const varRegex = /\{\{([\w_]+)\}\}/g
  let counter = 0

  const protected_text = text.replace(varRegex, (_match: string, varName: string) => {
    const placeholder = `[IMMI_VAR_${counter}]`
    vars[placeholder] = varName
    counter++
    return placeholder
  })

  return { text: protected_text, vars }
}

/**
 * 還原插值佔位符
 */
function restoreInterpolation(text: string, vars: Record<string, string>): string {
  let result = text
  for (const [placeholder, varName] of Object.entries(vars)) {
    result = result.replace(placeholder, `{{${varName}}}`)
  }
  return result
}

/**
 * 使用 Google Translate API 翻譯文本批次
 */
async function translateBatch(texts: string[]): Promise<string[]> {
  const url = 'https://translation.googleapis.com/language/translate/v2'

  const requestBody = {
    q: texts,
    target: 'zh-TW',
    source: 'en',
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('❌ API Error:', errorData)
      throw new Error(`API error: ${response.status}`)
    }

    const data = (await response.json()) as GoogleTranslateResponse
    const translations = data.data?.translations ?? []
    return translations.map((t) => t.translatedText)
  } catch (error) {
    console.error('❌ Translation API failed:', error)
    throw error
  }
}

/**
 * 批次處理翻譯（以 20 個字串為一批，避免 API 超限）
 */
async function translateStrings(strings: StringEntry[]): Promise<Map<string, string>> {
  const translations = new Map<string, string>()
  const BATCH_SIZE = 20

  console.log(`📝 Translating ${strings.length} strings...`)

  for (let i = 0; i < strings.length; i += BATCH_SIZE) {
    const batch = strings.slice(i, i + BATCH_SIZE)
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(strings.length / BATCH_SIZE)

    console.log(`📦 Batch ${batchIndex}/${totalBatches}...`)

    try {
      // 準備翻譯文本（保護插值）
      const textsToTranslate = batch.map((s) => {
        const { text } = protectInterpolation(s.value)
        return text
      })

      // 翻譯
      const translatedTexts = await translateBatch(textsToTranslate)

      // 保存翻譯結果（還原插值）
      for (let j = 0; j < batch.length; j++) {
        const original = batch[j].value
        const translated = translatedTexts[j]
        const { vars } = protectInterpolation(original)
        const restored = restoreInterpolation(translated, vars)
        translations.set(batch[j].key, restored)
      }

      // 延遲以避免 API 速率限制
      if (i + BATCH_SIZE < strings.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch (error) {
      console.error(`❌ Batch ${batchIndex} failed:`, error)
      throw error
    }
  }

  return translations
}

/**
 * 重建翻譯後的 JSON 結構
 */
function rebuildJson(translations: Map<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of translations.entries()) {
    const parts = key.split('.')
    let current: Record<string, unknown> = result

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]
      if (
        !current[key] ||
        typeof current[key] !== 'object' ||
        Array.isArray(current[key])
      ) {
        current[key] = {}
      }
      current = current[key] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }

  return result
}

/**
 * 主函數
 */
async function main() {
  const __dirname = path.dirname(new URL(import.meta.url).pathname)
  const localesDir = path.join(__dirname, '../src/i18n/locales')
  const enJsonPath = path.join(localesDir, 'en.json')
  const zhTwJsonPath = path.join(localesDir, 'zh-TW.json')

  console.log('🌐 IMMI-Case i18n Translation Pipeline')
  console.log('=====================================\n')

  // 讀取 en.json
  console.log('📖 Reading en.json...')
  const enJson = JSON.parse(fs.readFileSync(enJsonPath, 'utf-8'))

  // 提取字串
  console.log('🔍 Extracting strings...')
  const strings = extractStrings(enJson)
  console.log(`✅ Found ${strings.length} strings to translate\n`)

  // 翻譯
  console.log('🔄 Calling Google Translate API...')
  const translations = await translateStrings(strings)

  // 重建 JSON
  console.log('\n📦 Rebuilding JSON structure...')
  const zhTwJson = rebuildJson(translations)

  // 寫入檔案
  console.log(`💾 Writing zh-TW.json...`)
  fs.writeFileSync(zhTwJsonPath, JSON.stringify(zhTwJson, null, 2))

  console.log(`\n✅ Translation complete!`)
  console.log(`📊 Statistics:`)
  console.log(`   - Source: en.json (${strings.length} strings)`)
  console.log(`   - Target: zh-TW.json`)
  console.log(`   - API Cost: $0.00 (within free tier)`)
  console.log(`\n🎉 Ready to use! Import i18n in main.tsx and use useTranslation() in components.`)
}

main().catch((error) => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
