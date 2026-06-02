interface TransitionAnimation {
  name: string
  delay?: number | string
  duration?: number | string
  easing?: string
  fillMode?: string
  direction?: string
}

interface TransitionAnimationPair {
  old: TransitionAnimation | TransitionAnimation[]
  new: TransitionAnimation | TransitionAnimation[]
}

export interface TransitionDirectionalAnimations {
  forwards: TransitionAnimationPair
  backwards: TransitionAnimationPair
}

export type TransitionAnimationValue =
  | 'initial'
  | 'slide'
  | 'fade'
  | 'none'
  | TransitionDirectionalAnimations

const PAGE_TRANSITION_DURATION = '240ms'
const PAGE_TRANSITION_EASING = 'cubic-bezier(0.76, 0, 0.24, 1)'

const fadeOut = {
  name: 'astroFadeOut',
  duration: PAGE_TRANSITION_DURATION,
  easing: PAGE_TRANSITION_EASING,
  fillMode: 'both',
}

const fadeIn = {
  name: 'astroFadeIn',
  duration: PAGE_TRANSITION_DURATION,
  delay: PAGE_TRANSITION_DURATION,
  easing: PAGE_TRANSITION_EASING,
  fillMode: 'both',
}

const fadeInUp = {
  name: 'articleFadeInUp',
  duration: PAGE_TRANSITION_DURATION,
  delay: PAGE_TRANSITION_DURATION,
  easing: PAGE_TRANSITION_EASING,
  fillMode: 'both',
}

export const pageTransition: TransitionDirectionalAnimations = {
  forwards: {
    old: fadeOut,
    new: fadeIn,
  },
  backwards: {
    old: fadeOut,
    new: fadeIn,
  },
}

export const articlePaneTransition: TransitionDirectionalAnimations = {
  forwards: {
    old: fadeOut,
    new: fadeInUp,
  },
  backwards: {
    old: fadeOut,
    new: fadeInUp,
  },
}
