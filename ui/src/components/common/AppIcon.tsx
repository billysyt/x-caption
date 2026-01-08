import type { CSSProperties } from "react";
import type { IconType } from "react-icons";
import { cn } from "../../lib/cn";
import {
  FaBan,
  FaBars,
  FaCheck,
  FaCheckCircle,
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaClosedCaptioning,
  FaClock,
  FaCloudDownloadAlt,
  FaCloudUploadAlt,
  FaCog,
  FaCompress,
  FaCopy,
  FaCut,
  FaExchangeAlt,
  FaDownload,
  FaEdit,
  FaExpand,
  FaExclamationCircle,
  FaExclamationTriangle,
  FaFilter,
  FaGithub,
  FaFileAudio,
  FaFileImport,
  FaFolderOpen,
  FaGlobe,
  FaHistory,
  FaHourglassStart,
  FaInbox,
  FaLink,
  FaMagnet,
  FaMinus,
  FaMousePointer,
  FaMicrophoneSlash,
  FaPause,
  FaPlay,
  FaPlus,
  FaRegSquare,
  FaRegWindowRestore,
  FaSpinner,
  FaSortAmountDownAlt,
  FaStar,
  FaTimes,
  FaTrashAlt,
  FaThumbtack,
  FaUpload,
  FaUser,
  FaUserAlt,
  FaUsers,
  FaVideo,
  FaVolumeUp,
  FaYoutube
} from "react-icons/fa";
import { BsStars } from "react-icons/bs";

const icons = {
  upload: FaUpload,
  bars: FaBars,
  history: FaHistory,
  cloudUploadAlt: FaCloudUploadAlt,
  chevronDown: FaChevronDown,
  chevronLeft: FaChevronLeft,
  chevronRight: FaChevronRight,
  filter: FaFilter,
  sort: FaSortAmountDownAlt,
  fileAudio: FaFileAudio,
  times: FaTimes,
  pause: FaPause,
  play: FaPlay,
  cursor: FaMousePointer,
  cut: FaCut,
  copy: FaCopy,
  magnet: FaMagnet,
  link: FaLink,
  plus: FaPlus,
  users: FaUsers,
  user: FaUser,
  userSimple: FaUserAlt,
  spinner: FaSpinner,
  check: FaCheck,
  trashAlt: FaTrashAlt,
  inbox: FaInbox,
  microphoneSlash: FaMicrophoneSlash,
  cloudDownloadAlt: FaCloudDownloadAlt,
  exclamationCircle: FaExclamationCircle,
  clock: FaClock,
  hourglassStart: FaHourglassStart,
  cog: FaCog,
  exchangeAlt: FaExchangeAlt,
  exclamationTriangle: FaExclamationTriangle,
  ban: FaBan,
  checkCircle: FaCheckCircle,
  minus: FaMinus,
  download: FaDownload,
  edit: FaEdit,
  expand: FaExpand,
  compress: FaCompress,
  pin: FaThumbtack,
  pinOff: FaThumbtack,
  folderOpen: FaFolderOpen,
  globe: FaGlobe,
  fileImport: FaFileImport,
  windowMinimize: FaMinus,
  windowMaximize: FaRegSquare,
  windowRestore: FaRegWindowRestore,
  video: FaVideo,
  volume: FaVolumeUp,
  captions: FaClosedCaptioning,
  sparkle: FaStar,
  aiStar: BsStars,
  youtube: FaYoutube,
  github: FaGithub
} as const satisfies Record<string, IconType>;

export type AppIconName = keyof typeof icons;

export function AppIcon(props: {
  name: AppIconName;
  className?: string;
  style?: CSSProperties;
  size?: string | number;
  spin?: boolean;
}) {
  const Icon = icons[props.name];
  return (
    <Icon
      className={cn("stt-icon", props.spin && "animate-spin", props.className)}
      style={props.style}
      size={props.size}
      aria-hidden="true"
      focusable="false"
    />
  );
}
