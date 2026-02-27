export interface FilterSetting {
  
  categories: string[]

  
  difficulties: (1 | 2 | 3 | 4 | 5 | 6)[]

  
  tags: string[]

  
  status: SolvedStatus | null

  
  searchQuery: string | null

  
  showDisabledChallenges: boolean

  
  restrictToTutorialChallengesFirst: boolean
}

export type SolvedStatus = 'solved' | 'unsolved' | 'partially-solved'

export const DEFAULT_FILTER_SETTING: Readonly<FilterSetting> = Object.freeze({
  categories: [],
  difficulties: [],
  tags: [],
  status: null,
  searchQuery: null,
  showDisabledChallenges: true,
  restrictToTutorialChallengesFirst: false
})
