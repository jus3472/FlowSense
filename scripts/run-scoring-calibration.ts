import {
  CALIBRATION_BASELINES,
  CALIBRATION_FIXTURES,
  runCalibrationCorpus,
} from '../src/lib/scoring/v2/calibration'
import {
  REVIEWED_CALIBRATION_CORPUS,
  evaluateReviewedCalibrationCorpus,
} from '../src/lib/scoring/v2/calibration-reviewed'
import { runDeliveryNextCalibration } from '../src/lib/scoring/v2/delivery-next-calibration'
import { runV3EnergyCalibration } from '../src/lib/scoring/v3/energy-calibration'

const result = runCalibrationCorpus(CALIBRATION_FIXTURES, CALIBRATION_BASELINES)
console.log('Exact snapshot drift corpus')
console.log(result.report)

const reviewed = evaluateReviewedCalibrationCorpus(REVIEWED_CALIBRATION_CORPUS)
console.log('\nReviewed range corpus')
console.log(reviewed.report)
console.log(
  `Reviewed range summary: strict_failures=${reviewed.strictFailures.length} observations=${reviewed.observations.length}`,
)

const deliveryNext = runDeliveryNextCalibration()
console.log('\nDelivery next calibration evidence')
console.log(deliveryNext.report)
for (const difference of deliveryNext.differences) console.log(`  ${difference}`)

const v3Energy = runV3EnergyCalibration()
console.log('\nv3 Energy calibration evidence')
console.log(v3Energy.report)

if (!result.ok || !reviewed.ok || !deliveryNext.ok || !v3Energy.ok) process.exitCode = 1
