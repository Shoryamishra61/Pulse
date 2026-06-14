/**
 * PULSE CRM — Segment Storage Service
 * 
 * Manages persistent segment storage with in-memory store.
 * Production: Migrate to PostgreSQL with segments table.
 * 
 * Reference: PRD FR-08 - Named Segment Storage (P1-001 FIX)
 * Reference: SRS §5 - Database Schema - Segment entity
 */

import { v4 as uuidv4 } from 'uuid';
import type { PredicateNode } from './predicate-compiler';
import { db } from '@/lib/db';
import { segments } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export interface Segment {
  id: string;
  name: string;
  description?: string;
  predicate: PredicateNode;
  member_count: number;
  created_at: Date;
  updated_at: Date;
  last_evaluated_at?: Date;
}

interface CreateSegmentInput {
  name: string;
  description?: string;
  predicate: PredicateNode;
  member_count: number;
}

interface UpdateSegmentInput {
  name?: string;
  description?: string;
  predicate?: PredicateNode;
  member_count?: number;
}

class SegmentStore {
  private memorySegments = new Map<string, Segment>();

  /**
   * Create a new segment
   */
  async createSegment(input: CreateSegmentInput): Promise<Segment> {
    const now = new Date();
    const segment: Segment = {
      id: uuidv4(),
      name: input.name,
      description: input.description,
      predicate: input.predicate,
      member_count: input.member_count,
      created_at: now,
      updated_at: now,
      last_evaluated_at: now,
    };

    if (db) {
      await db.insert(segments).values({
        id: segment.id,
        name: segment.name,
        description: segment.description,
        definition: segment.predicate as any,
        memberCount: segment.member_count,
        createdAt: segment.created_at,
        updatedAt: segment.updated_at,
      });
    } else {
      this.memorySegments.set(segment.id, segment);
    }
    return segment;
  }

  /**
   * Get segment by ID
   */
  async getSegment(id: string): Promise<Segment | undefined> {
    if (db) {
      const result = await db.select().from(segments).where(eq(segments.id, id)).limit(1);
      if (!result.length) return undefined;
      const s = result[0];
      return {
        id: s.id,
        name: s.name,
        description: s.description || undefined,
        predicate: s.definition as unknown as PredicateNode,
        member_count: s.memberCount || 0,
        created_at: s.createdAt || new Date(),
        updated_at: s.updatedAt || new Date(),
        last_evaluated_at: s.updatedAt || new Date(),
      };
    }
    return this.memorySegments.get(id);
  }

  /**
   * Get segment by name
   */
  async getSegmentByName(name: string): Promise<Segment | undefined> {
    if (db) {
      const result = await db.select().from(segments).where(eq(segments.name, name)).limit(1);
      if (!result.length) return undefined;
      const s = result[0];
      return {
        id: s.id,
        name: s.name,
        description: s.description || undefined,
        predicate: s.definition as unknown as PredicateNode,
        member_count: s.memberCount || 0,
        created_at: s.createdAt || new Date(),
        updated_at: s.updatedAt || new Date(),
        last_evaluated_at: s.updatedAt || new Date(),
      };
    }
    return Array.from(this.memorySegments.values()).find(s => s.name === name);
  }

  /**
   * List all segments
   */
  async listSegments(): Promise<Segment[]> {
    if (db) {
      const result = await db.select().from(segments).orderBy(desc(segments.createdAt));
      return result.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description || undefined,
        predicate: s.definition as unknown as PredicateNode,
        member_count: s.memberCount || 0,
        created_at: s.createdAt || new Date(),
        updated_at: s.updatedAt || new Date(),
        last_evaluated_at: s.updatedAt || new Date(),
      }));
    }
    return Array.from(this.memorySegments.values());
  }

  /**
   * Update segment
   */
  async updateSegment(id: string, input: UpdateSegmentInput): Promise<Segment | undefined> {
    const existing = await this.getSegment(id);
    if (!existing) return undefined;

    const updated: Segment = {
      ...existing,
      ...(input.name && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.predicate && { predicate: input.predicate }),
      ...(input.member_count !== undefined && { member_count: input.member_count }),
      updated_at: new Date(),
    };

    if (db) {
      await db.update(segments).set({
        name: updated.name,
        description: updated.description,
        definition: updated.predicate as any,
        memberCount: updated.member_count,
        updatedAt: updated.updated_at,
      }).where(eq(segments.id, id));
    } else {
      this.memorySegments.set(id, updated);
    }
    return updated;
  }

  /**
   * Delete segment
   */
  async deleteSegment(id: string): Promise<boolean> {
    if (db) {
      const result = await db.delete(segments).where(eq(segments.id, id)).returning();
      return result.length > 0;
    }
    return this.memorySegments.delete(id);
  }

  /**
   * Re-evaluate segment membership (update member count)
   */
  async reevaluateSegment(id: string, newMemberCount: number): Promise<Segment | undefined> {
    return this.updateSegment(id, { member_count: newMemberCount });
  }

  /**
   * Get segment statistics
   */
  async getStats() {
    const allSegments = await this.listSegments();
    return {
      total: allSegments.length,
      total_members: allSegments.reduce((sum, s) => sum + s.member_count, 0),
      largest_segment: allSegments.reduce((max, s) => 
        s.member_count > max.member_count ? s : max, 
        allSegments[0] || { member_count: 0 }
      ),
    };
  }

  /**
   * Clear all segments (for testing/seeding)
   */
  async clear() {
    if (db) {
      await db.delete(segments);
    } else {
      this.memorySegments.clear();
    }
  }
}

// Singleton instance
export const segmentStore = new SegmentStore();

// Global access for Next.js hot reload preservation
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__pulseSegmentStore = segmentStore;
}
