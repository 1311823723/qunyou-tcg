export type ActionPayload = Record<string, unknown>;

export type ActionFeedback = { label: string; successMessage: string };

export type ActionTargetContext = {
  you?: string;
  markerOwnerId?: string;
};

export declare function actionFeedback(type: string, payload: ActionPayload, cardName?: string): ActionFeedback;
export declare function moveTargetKey(payload: ActionPayload): string;
export declare function actionTargetKey(type: string, payload: ActionPayload, context?: ActionTargetContext): string | undefined;
export declare function actionLockKey(type: string, payload: ActionPayload): string;
