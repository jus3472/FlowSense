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
if (!result.ok || !reviewed.ok || !deliveryNext.ok) process.exitCode = 1
