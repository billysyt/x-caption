import { PlayerPanel, type PlayerPanelProps } from "../components/PlayerPanel";

type PlayerPanelBaseProps = Omit<PlayerPanelProps, "isModal">;

export function usePlayerState(playerPanelProps: PlayerPanelBaseProps) {
  const playerPanel = <PlayerPanel isModal={false} {...playerPanelProps} />;
  const playerModalPanel = <PlayerPanel isModal {...playerPanelProps} />;

  return {
    playerPanelProps,
    playerPanel,
    playerModalPanel
  };
}
