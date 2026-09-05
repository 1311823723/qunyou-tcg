export type LocalSelectionAction = {
  command: string;
  payload: Record<string, unknown>;
  title: string;
  message: string;
  sourceId?: string;
  cardInstanceIds?: string[];
  min?: number;
  max?: number;
  selectionKind?: "cost" | "target-slot";
  costKind?: "rest" | "retire";
  options?: Array<{ label: string; payload: Record<string, unknown> }>;
};
export type LocalFormAction = { kind: "assisted"; action: string; title: string; message: string };
export type PendingAction = {
  id: string; type: string; baseRevision: number; sentAt: number;
  status: "pending" | "slow" | "stalled"; ackRevision?: number;
};
type Frame = { play: string; role: string; selection?: LocalSelectionAction; cards: string[] };

/** Local drafts are reversible; an authoritative submission never is. */
export class AutoInteraction {
  selectedPlayCardId = "";
  selectedRoleInstanceId = "";
  localSelectionAction?: LocalSelectionAction;
  localFormAction?: LocalFormAction;
  selectedDiscard = new Set<string>();
  selectedPromptCards = new Set<string>();
  pendingAction?: PendingAction;
  order?: { promptId: string; top: string[]; bottom: string[] };
  private history: Frame[] = [];
  checkpoint() {
    this.history.push({ play: this.selectedPlayCardId, role: this.selectedRoleInstanceId,
      selection: this.localSelectionAction ? structuredClone(this.localSelectionAction) : undefined,
      cards: [...this.selectedPromptCards] });
  }
  back() {
    const frame = this.history.pop();
    if (!frame) { this.clearDraft(); return; }
    this.selectedPlayCardId = frame.play;
    this.selectedRoleInstanceId = frame.role;
    this.localSelectionAction = frame.selection;
    this.selectedPromptCards = new Set(frame.cards);
  }
  clearDraft() {
    this.selectedPlayCardId = "";
    this.selectedRoleInstanceId = "";
    this.localSelectionAction = undefined;
    this.localFormAction = undefined;
    this.selectedPromptCards.clear();
    this.history = [];
  }
  resetDecision() { this.clearDraft(); this.selectedDiscard.clear(); this.order = undefined; }
  /** A server prompt is a committed boundary, not a step in local history. */
  submitted() { this.clearDraft(); this.selectedDiscard.clear(); this.order = undefined; }
}
