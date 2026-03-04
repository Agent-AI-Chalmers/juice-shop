import { type ComponentFixture, TestBed } from '@angular/core/testing'

import { DifficultyOverviewScoreCardComponent } from './difficulty-overview-score-card.component'
import { ScoreCardComponent } from '../score-card/score-card.component'
import { TranslateModule } from '@ngx-translate/core'

describe('DifficultyOverviewScoreCardComponent', () => {
  let component: DifficultyOverviewScoreCardComponent
  let fixture: ComponentFixture<DifficultyOverviewScoreCardComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), ScoreCardComponent,
        DifficultyOverviewScoreCardComponent]
    })
      .compileComponents()

    fixture = TestBed.createComponent(DifficultyOverviewScoreCardComponent)
    component = fixture.componentInstance
    component.allChallenges = []
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })

  describe('difficultySummaries', () => {
    it('should calculate difficulty summaries correctly for empty list of challenges', () => {
      expect(DifficultyOverviewScoreCardComponent.calculateDifficultySummaries([])).toEqual([
        { difficulty: 1, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 2, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 3, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 4, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 5, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 6, availableChallenges: 0, solvedChallenges: 0 }
      ])
    })
    it('should calculate difficulty summaries', () => {
      expect(DifficultyOverviewScoreCardComponent.calculateDifficultySummaries([
        { difficulty: 1, solved: true } as any,
        { difficulty: 1, solved: true } as any
      ])).toEqual([
        { difficulty: 1, availableChallenges: 2, solvedChallenges: 2 },
        { difficulty: 2, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 3, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 4, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 5, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 6, availableChallenges: 0, solvedChallenges: 0 }
      ])
    })
    it('should calculate difficulty summaries for multiple difficulties', () => {
      expect(DifficultyOverviewScoreCardComponent.calculateDifficultySummaries([
        { difficulty: 1, solved: true } as any,
        { difficulty: 1, solved: true } as any,
        { difficulty: 1, solved: true } as any,
        { difficulty: 1, solved: true } as any,
        { difficulty: 1, solved: false } as any,
        { difficulty: 2, solved: true } as any,
        { difficulty: 3, solved: false } as any
      ])).toEqual([
        { difficulty: 1, availableChallenges: 5, solvedChallenges: 4 },
        { difficulty: 2, availableChallenges: 1, solvedChallenges: 1 },
        { difficulty: 3, availableChallenges: 1, solvedChallenges: 0 },
        { difficulty: 4, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 5, availableChallenges: 0, solvedChallenges: 0 },
        { difficulty: 6, availableChallenges: 0, solvedChallenges: 0 }
      ])
    })
  })
})
