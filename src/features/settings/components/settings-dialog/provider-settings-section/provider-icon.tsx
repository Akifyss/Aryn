import type { ReactNode } from 'react'
import { Key2Line } from '@mingcute/react/key-2'
import type { AppIconSize } from '@/components/icon-size'
// Import the displayed SVG variants directly. The aggregate icon objects attach
// Avatar/Combine components and pull their UI dependencies into the build graph.
import Azure from '@lobehub/icons/es/Azure/components/Color'
import Bedrock from '@lobehub/icons/es/Bedrock/components/Color'
import Cerebras from '@lobehub/icons/es/Cerebras/components/Color'
import Claude from '@lobehub/icons/es/Claude/components/Color'
import Cloudflare from '@lobehub/icons/es/Cloudflare/components/Color'
import DeepSeek from '@lobehub/icons/es/DeepSeek/components/Color'
import Fireworks from '@lobehub/icons/es/Fireworks/components/Color'
import Gemini from '@lobehub/icons/es/Gemini/components/Color'
import GithubCopilot from '@lobehub/icons/es/GithubCopilot/components/Mono'
import Groq from '@lobehub/icons/es/Groq/components/Mono'
import HuggingFace from '@lobehub/icons/es/HuggingFace/components/Color'
import Minimax from '@lobehub/icons/es/Minimax/components/Color'
import Mistral from '@lobehub/icons/es/Mistral/components/Color'
import Moonshot from '@lobehub/icons/es/Moonshot/components/Mono'
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono'
import OpenCode from '@lobehub/icons/es/OpenCode/components/Mono'
import OpenRouter from '@lobehub/icons/es/OpenRouter/components/Mono'
import Together from '@lobehub/icons/es/Together/components/Color'
import Vercel from '@lobehub/icons/es/Vercel/components/Mono'
import XAI from '@lobehub/icons/es/XAI/components/Mono'
import XiaomiMiMo from '@lobehub/icons/es/XiaomiMiMo/components/Mono'
import ZAI from '@lobehub/icons/es/ZAI/components/Mono'

function ProviderIconFrame({
  children,
  size,
}: {
  children: ReactNode
  size: AppIconSize
}) {
  return (
    <div
      className='provider-icon'
      data-size={size}
    >
      {children}
    </div>
  )
}

export function ProviderIcon({
  provider,
  size = 'lg',
}: {
  provider: string
  size?: AppIconSize
}) {
  let icon: ReactNode

  switch (provider) {
    case 'openai-codex':
    case 'openai':
      icon = <OpenAI />
      break
    case 'zai':
      icon = <ZAI />
      break
    case 'opencode':
    case 'opencode-go':
      icon = <OpenCode />
      break
    case 'anthropic':
      icon = <Claude />
      break
    case 'github-copilot':
      icon = <GithubCopilot />
      break
    case 'openrouter':
      icon = <OpenRouter />
      break
    case 'google':
    case 'google-vertex':
      icon = <Gemini />
      break
    case 'deepseek':
      icon = <DeepSeek />
      break
    case 'mistral':
      icon = <Mistral />
      break
    case 'groq':
      icon = <Groq />
      break
    case 'cerebras':
      icon = <Cerebras />
      break
    case 'xai':
      icon = <XAI />
      break
    case 'vercel-ai-gateway':
      icon = <Vercel />
      break
    case 'huggingface':
      icon = <HuggingFace />
      break
    case 'fireworks':
      icon = <Fireworks />
      break
    case 'together':
      icon = <Together />
      break
    case 'kimi-coding':
      icon = <Moonshot />
      break
    case 'minimax':
    case 'minimax-cn':
      icon = <Minimax />
      break
    case 'moonshotai':
    case 'moonshotai-cn':
      icon = <Moonshot />
      break
    case 'xiaomi':
    case 'xiaomi-token-plan-cn':
    case 'xiaomi-token-plan-ams':
    case 'xiaomi-token-plan-sgp':
      icon = <XiaomiMiMo />
      break
    case 'azure-openai-responses':
      icon = <Azure />
      break
    case 'cloudflare-ai-gateway':
    case 'cloudflare-workers-ai':
      icon = <Cloudflare />
      break
    case 'amazon-bedrock':
      icon = <Bedrock />
      break
    default:
      icon = <Key2Line aria-hidden='true' />
  }

  return (
    <ProviderIconFrame size={size}>
      {icon}
    </ProviderIconFrame>
  )
}
