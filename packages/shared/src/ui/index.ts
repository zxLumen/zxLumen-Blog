export { PreferencesProvider, usePrefs, useTheme } from './theme-context.js'
export type { FeatureId } from '../features.js'
export { ThemePicker } from './ThemePicker.js'
export { nickKey, themeKey, appsOrderKey, aiVoiceKey, selSuffix } from './identity.js'
export { useDragReorder, applySavedOrder } from './useDragReorder.js'
export type { DropTarget, DragReorder, DragReorderOptions } from './useDragReorder.js'
export { ThemeGrid, LayoutGrid } from './PickGrid.js'
export { Typewriter } from './Typewriter.js'
export { Topbar } from './Topbar.js'
export { Hero } from './Hero.js'
export { Section } from './Section.js'
export { Pagination } from './Pagination.js'
export { ProjectsSection } from './ProjectsSection.js'
export { UsageSection } from './UsageSection.js'
export { AboutSection } from './AboutSection.js'
export { ContactActions } from './ContactActions.js'
export { GuestbookSection } from './GuestbookSection.js'
export type { NewComment } from './GuestbookSection.js'
export { HomePage } from './HomePage.js'
export { StatsWidget } from './StatsWidget.js'
export { StatusWidget } from './StatusWidget.js'
export { Sparkline } from './Sparkline.js'
export type { SparkPoint } from './Sparkline.js'
export { TrackBeacon } from './TrackBeacon.js'
export { trackEvent } from './track.js'
export { AdminPanel } from './AdminPanel.js'
export { Footer } from './Footer.js'
export { Shell } from './Shell.js'
export { ChatWidget } from './ChatWidget.js'
export { AppDock } from './AppDock.js'
export { AiStatusLight } from './AiStatusLight.js'
export {
  AI_SOURCES,
  AI_LABEL,
  reportAiState,
  setAiSourceAvailable,
  isAiState,
  useAiStatus,
  useReportAiState,
} from './ai-status.js'
export type { AiState, AiSource } from './ai-status.js'
export {
  AI_VOICE_EVENTS,
  AI_VOICE_FILES,
  AI_VOICE_FOR_STATE,
AI_VOICE_MIN_GAP_MS,
 planVoice,
  pickVoiceFile,
  useAiVoice,
} from './ai-voice.js'
export type { AiVoiceEvent } from './ai-voice.js'
export { AppPanelProvider, useAppPanel } from './AppPanel.js'
export {
  FLOATS_CHANGE_EVENT,
  readFloatsHidden,
  setFloatsHidden,
  subscribeFloatsHidden,
} from './floats-pref.js'
export { WeChatIcon, GitHubIcon, MailIcon, PhoneIcon, MessageIcon } from './icons.js'
export type { NavItem, LinkProps, LinkComponent } from './types.js'
export type { Contacts, Profile } from '../content.js'
export type { LayoutId } from '../theme.js'
export type { AppItem, AppOpenIn, StoredApp } from '../schema.js'
