import { createLogger } from './logger.js';
import { getJobMappings, getAllJobTypes, getJobDefinition } from '../config/job-definitions.js';

const logger = createLogger({ component: 'job-mapper' });

/**
 * Enhanced job mapper with intelligent pattern matching
 * Now uses centralized job definitions
 */
export class JobMapper {
  private static readonly FALLBACK_JOB = 'ocp-nightly';

  /**
   * Map job name to job type using intelligent pattern matching
   */
  static mapJobNameToType(jobName: string): {
    jobType: string;
    confidence: number;
    mapping?: any;
    suggestions?: string[];
  } {
    if (!jobName || typeof jobName !== 'string') {
      logger.warn('Invalid job name provided');
      return {
        jobType: this.FALLBACK_JOB,
        confidence: 0,
        suggestions: this.getAvailableJobTypes(),
      };
    }

    logger.debug(`Mapping job name: ${jobName}`);

    const jobMappings = getJobMappings();

    // Find all matching patterns
    const matches = jobMappings
      .map((mapping) => ({
        mapping,
        match: mapping.pattern.test(jobName),
        score: this.calculateMatchScore(jobName, mapping),
      }))
      .filter((result) => result.match)
      .sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      logger.warn(`No pattern matched for job name: ${jobName}`);
      const suggestions = this.getSuggestions(jobName);

      return {
        jobType: this.FALLBACK_JOB,
        confidence: 0,
        suggestions,
      };
    }

    const bestMatch = matches[0];
    const confidence = this.calculateConfidence(bestMatch.score, matches.length);

    logger.info(
      `Job mapped: ${jobName} → ${bestMatch.mapping.jobType} (confidence: ${confidence}%)`
    );

    return {
      jobType: bestMatch.mapping.jobType,
      confidence,
      mapping: bestMatch.mapping,
    };
  }

  /**
   * Calculate match score based on pattern priority and match quality
   */
  private static calculateMatchScore(jobName: string, mapping: any): number {
    // Base score from priority
    let score = mapping.priority;

    // Bonus for exact match in examples
    if (mapping.examples.includes(jobName)) {
      score += 50;
    }

    // Bonus for pattern match quality
    const match = jobName.match(mapping.pattern);
    if (match && match[0] === jobName) {
      // Full match
      score += 30;
    } else if (match && match[0].length > jobName.length * 0.8) {
      // Good partial match
      score += 20;
    }

    return score;
  }

  /**
   * Calculate confidence percentage based on score and competition
   */
  private static calculateConfidence(score: number, matchCount: number): number {
    // Base confidence from score
    let confidence = Math.min(100, score);

    // Reduce confidence if multiple matches
    if (matchCount > 1) {
      confidence = Math.floor(confidence * 0.8);
    }

    return confidence;
  }

  /**
   * Get job type suggestions based on similarity
   */
  private static getSuggestions(jobName: string): string[] {
    const allTypes = this.getAvailableJobTypes();
    const similarities = allTypes
      .map((type) => ({
        type,
        distance: this.levenshteinDistance(jobName.toLowerCase(), type.toLowerCase()),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    return similarities.map((s) => s.type);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private static levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Get all available job types
   */
  static getAvailableJobTypes(): string[] {
    return getAllJobTypes();
  }

  /**
   * Check if a job type is valid
   */
  static isValidJobType(jobType: string): boolean {
    return !!getJobDefinition(jobType);
  }

  /**
   * Get job mappings information for documentation
   */
  static getJobMappingsInfo(): Array<{
    jobType: string;
    description: string;
    priority: number;
    pattern: RegExp;
    examples: string[];
  }> {
    return getJobMappings();
  }

  /**
   * Test pattern matching for debugging
   */
  static testPatternMatching(jobName: string): Array<{
    jobType: string;
    pattern: string;
    matches: boolean;
    score: number;
  }> {
    const jobMappings = getJobMappings();

    return jobMappings.map((mapping) => ({
      jobType: mapping.jobType,
      pattern: mapping.pattern.source,
      matches: mapping.pattern.test(jobName),
      score: this.calculateMatchScore(jobName, mapping),
    }));
  }
}
