import { SerializableEdit } from './SerializableEdit';

export interface PendingFix {
  id: string;
  checkName: string;
  filePath: string;
  relPath: string;
  line: number;
  before: string;
  after: string;
  edits: SerializableEdit[];
}
