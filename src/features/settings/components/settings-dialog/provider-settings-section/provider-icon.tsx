import type { ReactNode } from 'react'
import { Key2Line } from '@mingcute/react'
import type { AppIconSize } from '@/components/icon-size'
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
  (props: { size?: number }): ReactNode
  Color?: LobeIconRenderer
}

function renderLobeIcon(IconComponent: LobeIconRenderer) {
  if (IconComponent.Color) {
    const ColorIcon = IconComponent.Color
    return <ColorIcon />
  }

  const ProviderIcon = IconComponent
  return <ProviderIcon />
}

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
      icon = renderLobeIcon(OpenAI)
      break
    case 'zai':
      icon = renderLobeIcon(ZAI)
      break
    case 'opencode':
    case 'opencode-go':
      icon = renderLobeIcon(OpenCode)
      break
    case 'anthropic':
      icon = renderLobeIcon(Claude)
      break
    case 'github-copilot':
      icon = renderLobeIcon(GithubCopilot)
      break
    case 'openrouter':
      icon = renderLobeIcon(OpenRouter)
      break
    case 'google':
    case 'google-vertex':
      icon = renderLobeIcon(Gemini)
      break
    case 'deepseek':
      icon = renderLobeIcon(DeepSeek)
      break
    case 'mistral':
      icon = renderLobeIcon(Mistral)
      break
    case 'groq':
      icon = renderLobeIcon(Groq)
      break
    case 'cerebras':
      icon = renderLobeIcon(Cerebras)
      break
    case 'xai':
      icon = renderLobeIcon(XAI)
      break
    case 'vercel-ai-gateway':
      icon = renderLobeIcon(Vercel)
      break
    case 'huggingface':
      icon = renderLobeIcon(HuggingFace)
      break
    case 'fireworks':
      icon = renderLobeIcon(Fireworks)
      break
    case 'together':
      icon = renderLobeIcon(Together)
      break
    case 'kimi-coding':
      icon = renderLobeIcon(Moonshot)
      break
    case 'minimax':
    case 'minimax-cn':
      icon = renderLobeIcon(Minimax)
      break
    case 'moonshotai':
    case 'moonshotai-cn':
      icon = renderLobeIcon(Moonshot)
      break
    case 'xiaomi':
    case 'xiaomi-token-plan-cn':
    case 'xiaomi-token-plan-ams':
    case 'xiaomi-token-plan-sgp':
      icon = renderLobeIcon(XiaomiMiMo)
      break
    case 'azure-openai-responses':
      icon = renderLobeIcon(Azure)
      break
    case 'cloudflare-ai-gateway':
    case 'cloudflare-workers-ai':
      icon = renderLobeIcon(Cloudflare)
      break
    case 'amazon-bedrock':
      icon = renderLobeIcon(Bedrock)
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
