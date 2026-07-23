import { generateOpenAiCompatible } from './openai-compatible'
import type { ProviderArgs } from './shared'

/**
 * Backwards compatibility alias for generateOpenAiCompatible.
 */
export async function generateOpenAi(args: ProviderArgs): Promise<string> {
  return generateOpenAiCompatible({
    ...args,
    providerName: args.providerName || 'OpenAI',
  })
}
