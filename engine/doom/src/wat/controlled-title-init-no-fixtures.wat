;; Same one-shot reactor guard as controlled-title-init, without diagnostic work.
(module
 (import "has-two-init-functions" "_initialize" (func $wasi))
 (import "has-two-init-functions" "_initializeControlled" (func $doom (result i32)))
 (global $attempted (mut i32) (i32.const 0))
 (func (export "initControlled") (result i32)
  (if (global.get $attempted) (then (return (i32.const -1))))
  (global.set $attempted (i32.const 1))
  (call $wasi)
  (call $doom)
 )
)
