module Data.File exposing
    ( EncodedFile
    , File
    , decode
    , dirPath
    , fileName
    , splitName
    )

import Time


type alias File =
    { filename : String
    , icon : String
    , path : String
    , size : Int
    , updated : Time.Posix
    }


splitName : String -> ( String, String )
splitName filename =
    case List.reverse (String.split "." filename) of
        [] ->
            ( "", "" )

        [ rest ] ->
            ( rest, "" )

        [ ext, rest ] ->
            if rest == "" then
                ( "." ++ ext, "" )

            else
                ( rest, "." ++ ext )

        ext :: rest ->
            ( String.join "." (List.reverse rest), "." ++ ext )


dirPath : String -> String -> String -> String
dirPath pathSeparator path filename =
    pathSeparator ++ String.replace filename "" path


fileName : String -> String -> String
fileName pathSeparator path =
    String.split pathSeparator path
        |> List.filter (not << String.isEmpty)
        |> List.reverse
        |> List.head
        |> Maybe.withDefault ""


type alias EncodedFile =
    { filename : String
    , icon : String
    , path : String
    , size : Int
    , updated : Int
    }


decode : EncodedFile -> File
decode encoded =
    let
        { filename, icon, path, size } =
            encoded

        posixTime =
            Time.millisToPosix encoded.updated
    in
    { filename = filename, icon = icon, path = path, size = size, updated = posixTime }
