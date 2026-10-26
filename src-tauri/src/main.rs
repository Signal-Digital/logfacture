// Empêche l'ouverture d'une console supplémentaire sous Windows en mode release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    signal_desk_lib::run()
}
