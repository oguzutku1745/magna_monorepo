// Public synthetic test data. No Passport witness is used.
fn main(value: Field) -> pub [Field; 8] {
    assert(value == 1234);
    [value, 18, 1900000000, 20, 30, 40, 50, 60]
}
