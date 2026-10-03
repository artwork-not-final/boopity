export interface QuickStartFile {
  path: string;
  content: string;
  executable?: boolean;
}

export function quickStartFiles(
  root: string,
  version: string,
  image: string,
): QuickStartFile[];

export function packageQuickStart(
  root: string,
  parent: string,
  version: string,
  image: string,
): {
  destination: string;
  archive: string;
  sha256: string;
  files: number;
  image: string;
  version: string;
};
