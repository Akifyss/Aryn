import type { ReactNode } from 'react'
import { Icon } from '@iconify/react'
import {
  Azure,
  Bedrock,
  Cerebras,
  Claude,
  Cloudflare,
  DeepSeek,
  Fireworks,
  Gemini,
  GithubCopilot,
  Groq,
  HuggingFace,
  Minimax,
  Mistral,
  Moonshot,
  OpenAI,
  OpenCode,
  OpenRouter,
  Together,
  Vercel,
  XAI,
  XiaomiMiMo,
  ZAI,
} from '@lobehub/icons'

type LobeIconRenderer = {
  (props: { size: number }): ReactNode
  Color?: LobeIconRenderer
}

function renderLobeIcon(IconComponent: LobeIconRenderer, size: number) {
  if (IconComponent.Color) {
    const ColorIcon = IconComponent.Color
    return <ColorIcon size={size} />
  }

  const ProviderIcon = IconComponent
  return <ProviderIcon size={size} />
}

function ProviderIconFrame({
  children,
  size,
}: {
  children: ReactNode
  size: number
}) {
  return (
    <div
      className='flex items-center justify-center flex-shrink-0'
      style={{ width: size, height: size }}
    >
      {children}
    </div>
  )
}

export function ProviderIcon({
  provider,
  size = 18,
}: {
  provider: string
  size?: number
}) {
  let icon: ReactNode

  switch (provider) {
    case 'openai-codex':
    case 'openai':
      icon = renderLobeIcon(OpenAI, size)
      break
    case 'zai':
      icon = renderLobeIcon(ZAI, size)
      break
    case 'opencode':
    case 'opencode-go':
      icon = renderLobeIcon(OpenCode, size)
      break
    case 'anthropic':
      icon = renderLobeIcon(Claude, size)
      break
    case 'github-copilot':
      icon = renderLobeIcon(GithubCopilot, size)
      break
    case 'openrouter':
      icon = renderLobeIcon(OpenRouter, size)
      break
    case 'google':
    case 'google-vertex':
      icon = renderLobeIcon(Gemini, size)
      break
    case 'deepseek':
      icon = renderLobeIcon(DeepSeek, size)
      break
    case 'mistral':
      icon = renderLobeIcon(Mistral, size)
      break
    case 'groq':
      icon = renderLobeIcon(Groq, size)
      break
    case 'cerebras':
      icon = renderLobeIcon(Cerebras, size)
      break
    case 'xai':
      icon = renderLobeIcon(XAI, size)
      break
    case 'vercel-ai-gateway':
      icon = renderLobeIcon(Vercel, size)
      break
    case 'huggingface':
      icon = renderLobeIcon(HuggingFace, size)
      break
    case 'fireworks':
      icon = renderLobeIcon(Fireworks, size)
      break
    case 'together':
      icon = renderLobeIcon(Together, size)
      break
    case 'kimi-coding':
      icon = renderLobeIcon(Moonshot, size)
      break
    case 'minimax':
    case 'minimax-cn':
      icon = renderLobeIcon(Minimax, size)
      break
    case 'moonshotai':
    case 'moonshotai-cn':
      icon = renderLobeIcon(Moonshot, size)
      break
    case 'xiaomi':
    case 'xiaomi-token-plan-cn':
    case 'xiaomi-token-plan-ams':
    case 'xiaomi-token-plan-sgp':
      icon = renderLobeIcon(XiaomiMiMo, size)
      break
    case 'azure-openai-responses':
      icon = renderLobeIcon(Azure, size)
      break
    case 'cloudflare-ai-gateway':
    case 'cloudflare-workers-ai':
      icon = renderLobeIcon(Cloudflare, size)
      break
    case 'amazon-bedrock':
      icon = renderLobeIcon(Bedrock, size)
      break
    default:
      icon = <Icon icon='mingcute:key-2-line' style={{ fontSize: size * 0.7 }} />
  }

  return (
    <ProviderIconFrame size={size}>
      {icon}
    </ProviderIconFrame>
  )
}
