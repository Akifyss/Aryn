import type { SVGProps } from 'react'
import {
  AlignCenterLine,
  AlignJustifyLine,
  AlignLeftLine,
  AlignRightLine,
  ArrowLeftLine,
  BackLine,
  BlockquoteLine,
  BoldLine,
  BracketsLine,
  BrushLine,
  CheckboxLine,
  CloseLine,
  CodeLine,
  CornerDownLeftLine,
  Delete2Line,
  DownLine,
  ExternalLinkLine,
  FileCodeLine,
  ForwardLine,
  Heading1Line,
  Heading2Line,
  Heading3Line,
  ItalicLine,
  LinkLine,
  ListCheckLine,
  ListOrderedLine,
  MoonStarsLine,
  PicLine,
  StrikethroughLine,
  SunLine,
  UnderlineLine,
} from '@mingcute/react'

type IconProps = SVGProps<SVGSVGElement>

function TextIcon({
  className,
  label,
}: {
  className?: string
  label: string
}) {
  return (
    <svg
      aria-hidden='true'
      className={className}
      fill='none'
      viewBox='0 0 24 24'
      xmlns='http://www.w3.org/2000/svg'
    >
      <rect height='18' rx='4' stroke='currentColor' strokeWidth='1.8' width='18' x='3' y='3' />
      <text
        dominantBaseline='central'
        fill='currentColor'
        fontFamily='ui-sans-serif, sans-serif'
        fontSize='8'
        fontWeight='700'
        textAnchor='middle'
        x='12'
        y='12.5'
      >
        {label}
      </text>
    </svg>
  )
}

function SlashIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden='true'
      className={className}
      fill='none'
      viewBox='0 0 24 24'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path d='M8 18 16 6' stroke='currentColor' strokeLinecap='round' strokeWidth='1.8' />
      <path d='M6 18h4M14 6h4' stroke='currentColor' strokeLinecap='round' strokeWidth='1.8' />
    </svg>
  )
}

export const ArrowLeftIcon = ArrowLeftLine
export const HighlighterIcon = BrushLine
export const LinkIcon = LinkLine
export const MoonStarIcon = MoonStarsLine
export const SunIcon = SunLine
export const BlockquoteIcon = BlockquoteLine
export const CodeBlockIcon = FileCodeLine
export const BanIcon = CloseLine
export const CloseIcon = CloseLine
export const HeadingOneIcon = Heading1Line
export const HeadingTwoIcon = Heading2Line
export const HeadingThreeIcon = Heading3Line
export const HeadingFourIcon = (props: IconProps) => <TextIcon {...props} label='H4' />
export const HeadingFiveIcon = (props: IconProps) => <TextIcon {...props} label='H5' />
export const HeadingSixIcon = (props: IconProps) => <TextIcon {...props} label='H6' />
export const HeadingIcon = (props: IconProps) => <TextIcon {...props} label='H' />
export const ChevronDownIcon = DownLine
export const ImagePlusIcon = PicLine
export const CornerDownLeftIcon = CornerDownLeftLine
export const ExternalLinkIcon = ExternalLinkLine
export const TrashIcon = Delete2Line
export const ListIcon = BracketsLine
export const ListOrderedIcon = ListOrderedLine
export const ListTodoIcon = ListCheckLine
export const BoldIcon = BoldLine
export const Code2Icon = CodeLine
export const ItalicIcon = ItalicLine
export const StrikeIcon = StrikethroughLine
export const SubscriptIcon = SlashIcon
export const SuperscriptIcon = SlashIcon
export const UnderlineIcon = UnderlineLine
export const AlignCenterIcon = AlignCenterLine
export const AlignJustifyIcon = AlignJustifyLine
export const AlignLeftIcon = AlignLeftLine
export const AlignRightIcon = AlignRightLine
export const Redo2Icon = ForwardLine
export const Undo2Icon = BackLine
