// @ts-nocheck
export const emojiData: Record<string, string> = {
  smile: '😃',
  grinning: '😀',
  joy: '😂',
  sob: '😭',
  heart: '❤️',
  broken_heart: '💔',
  star: '⭐',
  sparkles: '✨',
  rocket: '🚀',
  fire: '🔥',
  warning: '⚠️',
  check: '✓',
  x: '✕',
  plus: '+',
  minus: '−',
  pencil: '✏️',
  memo: '📝',
  link: '🔗',
  paperclip: '📎',
  cloud: '☁️',
  sunny: '☀️',
  moon: '🌙',
  rainbow: '🌈',
  skull: '💀',
  alien: '👽',
  robot: '🤖',
  thumbsup: '👍',
  thumbsdown: '👎',
  clap: '👏',
  pray: '🙏',
  wave: '👋',
  eyes: '👀',
  coffee: '☕',
  writing: '✍️',
  book: '📘',
  books: '📚',
  calendar: '📅',
  bulb: '💡',
  gift: '🎁',
  tada: '🎉',
  camera: '📷',
  video: '📹',
  smartphone: '📱',
  computer: '💻',
  keyboard: '⌨️',
  lock: '🔒',
  unlock: '🔓',
  key: '🔑',
  flag_cn: '🇨🇳',
  flag_us: '🇺🇸',
  flag_jp: '🇯🇵',
}

export interface EmojiRange {
  emoji: string;
  from: number;
  to: number;
}

const emojiPattern = /:([a-zA-Z0-9_+-]+):/g;

export function collectEmojiRangesFromText(text: string, lineFrom: number): EmojiRange[] {
  const ranges: EmojiRange[] = [];

  emojiPattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = emojiPattern.exec(text)) !== null) {
    const emoji = emojiData[match[1]];
    if (!emoji) {
      continue;
    }

    ranges.push({
      emoji,
      from: lineFrom + match.index,
      to: lineFrom + match.index + match[0].length,
    });
  }

  return ranges;
}
