export type DeclarationCategory = "suit" | "rank" | "face" | "characterRole" | "handCard";

export type DeclarationOption = { value: string; label: string };

export declare const DECLARATION_CATEGORIES: ReadonlyArray<{
  value: DeclarationCategory;
  label: string;
}>;

export declare const DECLARATION_STATIC_OPTIONS: Readonly<Record<
  Exclude<DeclarationCategory, "handCard">,
  ReadonlyArray<string>
>>;

export declare function declarationOptions(
  category: DeclarationCategory,
  handCards: ReadonlyArray<{ id: string; name: string }>,
): DeclarationOption[];
