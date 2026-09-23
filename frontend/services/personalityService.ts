import {
  createPersonality,
  deletePersonality,
  fetchPersonalities,
  updatePersonality,
  type PersonalityInput,
} from '@/api/personalities';
import { useOfficeStore } from '@/store/officeStore';

/**
 * Personalities — who an agent is and how it speaks. Follows
 * Component -> Hook -> Service -> API; CRUD refreshes the store's list.
 *
 * Unlike rules and skills this is assigned to the AGENT, not the seat, so
 * assignment rides the ordinary agent save rather than a join table.
 */
export class PersonalityService {
  async load(): Promise<void> {
    useOfficeStore.getState().setPersonalities(await fetchPersonalities());
  }

  async create(input: PersonalityInput): Promise<void> {
    await createPersonality(input);
    await this.load();
  }

  async update(id: string, input: PersonalityInput): Promise<void> {
    await updatePersonality(id, input);
    await this.load();
  }

  /** Deleting frees every agent wearing it; the roster is refreshed so their
   *  dossiers stop showing a voice that no longer exists. */
  async remove(id: string): Promise<void> {
    await deletePersonality(id);
    await this.load();
  }
}

export const personalityService = new PersonalityService();
