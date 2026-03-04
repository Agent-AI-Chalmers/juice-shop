import { Component, Input, type OnChanges, type OnInit } from '@angular/core'

import { type EnrichedChallenge } from '../../types/EnrichedChallenge'
import { TranslateModule } from '@ngx-translate/core'

import { ScoreCardComponent } from '../score-card/score-card.component'

interface DifficultySummary {
  difficulty: 0 | 1 | 2 | 3 | 4 | 5 | 6
  availableChallenges: number
  solvedChallenges: number
}

// interface doesn't work here
 
type DifficultySummaries = Record<number, DifficultySummary>

const INITIAL_SUMMARIES: Readonly<DifficultySummaries> = Object.freeze({
  1: { difficulty: 1, availableChallenges: 0, solvedChallenges: 0 },
  2: { difficulty: 2, availableChallenges: 0, solvedChallenges: 0 },
  3: { difficulty: 3, availableChallenges: 0, solvedChallenges: 0 },
  4: { difficulty: 4, availableChallenges: 0, solvedChallenges: 0 },
  5: { difficulty: 5, availableChallenges: 0, solvedChallenges: 0 },
  6: { difficulty: 6, availableChallenges: 0, solvedChallenges: 0 }
})

@Component({
  selector: 'difficulty-overview-score-card',
  templateUrl: './difficulty-overview-score-card.component.html',
  styleUrls: ['./difficulty-overview-score-card.component.scss'],
  imports: [ScoreCardComponent, TranslateModule]
})
export class DifficultyOverviewScoreCardComponent implements OnInit, OnChanges {
  @Input()
  public allChallenges: EnrichedChallenge[] = []

  // includes hacking challenges
  public totalChallenges: number
  public solvedChallenges: number

  public difficultySummaries: DifficultySummary[] = [
    { difficulty: 1, availableChallenges: 0, solvedChallenges: 0 },
    { difficulty: 2, availableChallenges: 0, solvedChallenges: 0 },
    { difficulty: 3, availableChallenges: 0, solvedChallenges: 0 },
    { difficulty: 4, availableChallenges: 0, solvedChallenges: 0 },
    { difficulty: 5, availableChallenges: 0, solvedChallenges: 0 },
    { difficulty: 6, availableChallenges: 0, solvedChallenges: 0 }
  ]

  ngOnInit (): void {
    this.updatedNumberOfSolvedChallenges()
  }

  ngOnChanges (): void {
    this.updatedNumberOfSolvedChallenges()
  }

  private updatedNumberOfSolvedChallenges (): void {
    const solvedHackingChallenges = this.allChallenges
      .filter((challenge) => challenge.solved).length

    this.difficultySummaries = DifficultyOverviewScoreCardComponent.calculateDifficultySummaries(this.allChallenges)

    this.totalChallenges = this.allChallenges.length
    this.solvedChallenges = solvedHackingChallenges
  }

  static calculateDifficultySummaries (challenges: EnrichedChallenge[]): DifficultySummary[] {
    const summariesLookup: DifficultySummaries = structuredClone(INITIAL_SUMMARIES)
    for (const challenge of challenges) {
      summariesLookup[challenge.difficulty].availableChallenges += 1
      if (challenge.solved) {
        summariesLookup[challenge.difficulty].solvedChallenges++
      }
    }
    return Object.values(summariesLookup)
      .sort((a, b) => a.difficulty - b.difficulty)
  }
}
