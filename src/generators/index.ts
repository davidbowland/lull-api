import { Generator } from '../types'
import { goFigureGenerator } from './gofigure/generator'

// The registry the nightly handler loops. Adding a type is one entry here and nothing else in the
// pack pipeline -- createPack reads countPerDay and difficulties off the generator and never keys
// on position.
export const generators: Generator[] = [goFigureGenerator]
