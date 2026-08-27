import {
  CALIBRATION_BASELINES,
  CALIBRATION_FIXTURES,
  runCalibrationCorpus,
} from '../src/lib/scoring/v2/calibration'
import { runDeliveryNextCalibration } from '../src/lib/scoring/v2/delivery-next-calibration'

const result = runCalibrationCorpus(CALIBRATION_FIXTURES, CALIBRATION_BASELINES)
console.log(result.report)
const deliveryNext = runDeliveryNextCalibration()
console.log(deliveryNext.report)
for (const difference of deliveryNext.differences) console.log(`  ${difference}`)
if (!result.ok || !deliveryNext.ok) process.exitCode = 1
