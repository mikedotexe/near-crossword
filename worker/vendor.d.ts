declare module "crossword-layout-generator" {
  export interface LayoutItem {
    clue: string;
    answer: string;
    position: number | null;
    startx: number;
    starty: number;
    orientation: string;
  }

  export interface LayoutOutput {
    result: LayoutItem[];
    rows: number;
    cols: number;
  }

  export function generateLayout(
    input: { clue: string; answer: string }[]
  ): LayoutOutput;
}
