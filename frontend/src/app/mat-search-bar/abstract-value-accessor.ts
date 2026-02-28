import { type ControlValueAccessor } from '@angular/forms'

export abstract class AbstractControlValueAccessor
implements ControlValueAccessor {
  value: string

  
  onChange: (_: any) => void = () => {}
  
  onTouched: () => void = () => {}
  
  updateChanges () {
    this.onChange(this.value)
  }

  
  writeValue (value: string): void {
    this.value = value
    this.updateChanges()
  }

  
  registerOnChange (fn: any): void {
    this.onChange = fn
  }

  
  registerOnTouched (fn: any): void {
    this.onTouched = fn
  }
}
