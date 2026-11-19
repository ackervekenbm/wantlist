import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
)

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
  </Icon>
)

export const StarIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" />
  </Icon>
)

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)


// The app icon itself (drawn in scripts/gen-icons.mjs), so the header always matches the favicon.
export const LogoMark = () => <img src="/favicon.svg" width={28} height={28} alt="" />


export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5" />
  </Icon>
)

/** A cog: Settings. */
export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M9.8 4.8L10.4 2.1L13.6 2.1L14.2 4.8L15.5 5.4L17.9 3.9L20.1 6.1L18.6 8.5L19.2 9.8L21.9 10.4L21.9 13.6L19.2 14.2L18.6 15.5L20.1 17.9L17.9 20.1L15.5 18.6L14.2 19.2L13.6 21.9L10.4 21.9L9.8 19.2L8.5 18.6L6.1 20.1L3.9 17.9L5.4 15.5L4.8 14.2L2.1 13.6L2.1 10.4L4.8 9.8L5.4 8.5L3.9 6.1L6.1 3.9L8.5 5.4z" />
  </Icon>
)

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
  </Icon>
)

/** Half-filled circle: follow the system theme. */
export const SystemThemeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" />
  </Icon>
)

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
)

export const BackIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

/** Explore mode: two picks fanned out. */
export const ExploreIcon = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <rect x="3" y="6" width="10" height="13" rx="2" transform="rotate(-10 8 12)" />
    <rect x="11" y="5" width="10" height="13" rx="2" transform="rotate(8 16 11)" fill="var(--surface)" />
  </Icon>
)

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
)

export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </Icon>
)

/** Reaction glyphs on the keycaps. */
export const NoIcon = (p: IconProps) => (
  <Icon strokeWidth={2.4} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)

export const MaybeIcon = (p: IconProps) => (
  <Icon strokeWidth={2.4} {...p}>
    <path d="M4 13c2.5-3 5-3 8 0s5.5 3 8 0" />
  </Icon>
)

export const YesIcon = (p: IconProps) => (
  <Icon fill="currentColor" stroke="none" {...p}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </Icon>
)

/** The quiet stand-in for a missing product photo: a parcel. */
export const ParcelIcon = (p: IconProps) => (
  <Icon viewBox="0 0 80 80" {...p}>
    <path d="M14 28l26-12 26 12v26L40 66 14 54z" />
    <path d="M14 28l26 12 26-12M40 40v26M27 22l26 12" />
  </Icon>
)

/** Hunt mode: a perforated quote slip. */
export const HuntIcon = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Icon>
)
