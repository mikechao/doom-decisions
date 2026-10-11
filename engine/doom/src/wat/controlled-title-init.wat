;; Experimental one-shot reactor startup. State is outside C linear memory so
;; neither WASI initialization nor imported-callback reentry can reset it.
(module
 (import "has-two-init-functions" "_initialize" (func $wasi))
 (import "has-two-init-functions" "_initializeControlled" (func $doom (result i32)))
 (global $attempted (mut i32) (i32.const 0))
 (global $wasiCalls (mut i32) (i32.const 0))
 (func (export "initControlled") (result i32)
  (if (global.get $attempted) (then (return (i32.const -1))))
  (global.set $attempted (i32.const 1))
  (global.set $wasiCalls (i32.add (global.get $wasiCalls) (i32.const 1)))
  (call $wasi)
  (call $doom)
 )
 (func (export "a1WasiInitCount") (result i32) (global.get $wasiCalls))
)
