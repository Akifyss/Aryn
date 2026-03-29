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
import { Icon } from '@iconify/react'

type IconProps = SVGProps<SVGSVGElement>

/**
 * Fallback to Iconify for icons missing in MingCute
 */
const Iconify = ({ icon, className, ...props }: IconProps & { icon: string }) => (
  <Icon icon={icon} className={className} {...(props as any)} />
)

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
export const HeadingFourIcon = (props: IconProps) => <Iconify {...props} icon="lucide:heading-4" />
export const HeadingFiveIcon = (props: IconProps) => <Iconify {...props} icon="lucide:heading-5" />
export const HeadingSixIcon = (props: IconProps) => <Iconify {...props} icon="lucide:heading-6" />
export const HeadingIcon = (props: IconProps) => <Iconify {...props} icon="lucide:heading" />
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
export const SubscriptIcon = (props: IconProps) => <Iconify {...props} icon="lucide:subscript" />
export const SuperscriptIcon = (props: IconProps) => <Iconify {...props} icon="lucide:superscript" />
export const UnderlineIcon = UnderlineLine
export const AlignCenterIcon = AlignCenterLine
export const AlignJustifyIcon = AlignJustifyLine
export const AlignLeftIcon = AlignLeftLine
export const AlignRightIcon = AlignRightLine
export const Redo2Icon = ForwardLine
export const Undo2Icon = BackLine
