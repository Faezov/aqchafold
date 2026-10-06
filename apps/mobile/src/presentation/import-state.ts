import type { ImportStatementResult } from "../import/import-statement";
import type { SelectedDocument } from "../platform/pick-statement-document";

export type ImportResult =
  | {
      status: "imported";
      transactionCount: number;
      accountLabel: string;
      filename?: string;
    }
  | { status: "already-imported" }
  | { status: "unsupported" }
  | { status: "failed" };

export type ImportState =
  | { status: "ready"; document: SelectedDocument | null }
  | { status: "importing"; document: SelectedDocument }
  | { status: "finished"; document: SelectedDocument; result: ImportResult };

type ImportAction =
  | { type: "document-picked"; document: SelectedDocument | null }
  | { type: "started" }
  | {
      type: "finished";
      result: ImportStatementResult;
      accountLabel: string;
    };

/** Session-only selection and result; navigation does not change this state. */
export function importStateReducer(
  state: ImportState,
  action: ImportAction,
): ImportState {
  switch (action.type) {
    case "document-picked":
      return action.document === null
        ? state
        : { status: "ready", document: action.document };
    case "started":
      return state.document === null
        ? state
        : { status: "importing", document: state.document };
    case "finished": {
      if (state.status !== "importing") return state;
      const result: ImportResult =
        action.result.status === "imported"
          ? {
              status: "imported",
              transactionCount: action.result.transactionCount,
              accountLabel: action.accountLabel,
              ...(state.document.name ? { filename: state.document.name } : {}),
            }
          : { status: action.result.status };
      return { status: "finished", document: state.document, result };
    }
  }
}
